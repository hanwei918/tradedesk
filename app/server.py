"""TradeDesk local server (Python standard library only, no install needed).

    python3 server.py            # http://127.0.0.1:8765
    TRADEDESK_MODE=replay python3 server.py   # stage demo from cached answers
"""

import argparse
import csv
import io
import ipaddress
import json
import re
import socket
import threading
import time
import traceback
from urllib.parse import urlparse, parse_qs
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from tradedesk.kb import KnowledgeBase, PLATFORM_NAMES
from tradedesk.llm import LLM, LLMError
from tradedesk import checks, settings, savings
from tradedesk.board import Board, CHANNELS
from tradedesk.evaluate import evaluate, LABEL_ZH
from tradedesk.inbox import TASK_STATUS
from tradedesk.listing_catalog import public_catalog
from tradedesk.workflows import Runner, LOG_PATH, ROLES

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
STATE = ROOT / "state"
# What a phone on the venue Wi-Fi may reach. Everything else answers 403 to
# non-loopback clients, so visitors can never trigger paid model calls.
LAN_ALLOWED = re.compile(r"^/(play(\.html)?|play\.js|style\.css|icons\.svg|vendor/[\w-]+(?:\.[\w-]+)+|api/play/[\w-]+)(\?.*)?$")


class App:
    def __init__(self):
        self.kb = KnowledgeBase()
        self.llm = LLM()
        self.board = Board()
        self.runner = Runner(self.llm, self.kb, board=self.board)
        self.play_lock = threading.Lock()
        self.lan_url = None

    def meta(self):
        return {
            "llm": self.llm.describe(),
            "kb_version": self.kb.version,
            "rules_verified": len(self.kb.rules),
            "rules_total": len(self.kb.all_rules),
            "factory": self.kb.factory,
            "products": list(self.kb.products.values()),
            "inquiries": self.kb.inquiries,
            "platforms": PLATFORM_NAMES,
            "listing_catalog": public_catalog(),
            "roles": ROLES,
        }

    def kb_rules(self):
        return {"version": self.kb.version,
                "rules": [dict(KnowledgeBase.public(r), verified=r.get("verified"), check=r.get("check"),
                               platforms=r.get("platforms"), markets=r.get("markets"))
                          for r in self.kb.all_rules],
                "check_map": self.kb.check_map}

    # ---------------------------------------------------------- inbox & tasks
    def inbox_view(self):
        state = self.runner.inbox.inbox()
        items = []
        for q in self.kb.inquiries:
            st = state.get(q["id"], {})
            items.append({"inquiry": q, "priority": st.get("priority"), "understanding": st.get("understanding"),
                          "reply": st.get("reply"), "triaged": st.get("triaged")})
        items.sort(key=lambda x: -(x["priority"] or {}).get("score", -1))
        return {"items": items, "tasks": self.runner.inbox.tasks(), "task_status": TASK_STATUS}

    def task_status(self, payload):
        return self.runner.inbox.set_task_status(payload["id"], payload["status"])

    # ---------------------------------------------------------- model settings
    def settings_view(self):
        return dict(settings.public_view(), active=self.llm.describe())

    def settings_save(self, payload):
        v = settings.save(payload)
        self.llm = LLM(provider=v["provider"], endpoint=v["endpoint"], model=v["model"],
                       api_key=v["api_key"], mode=v["mode"])
        self.runner.llm = self.llm
        return self.settings_view()

    def settings_test(self, payload):
        """One tiny real call through the saved settings, bypassing the cache."""
        if not self.llm.api_key:
            raise ValueError("还没有填写 key")
        started = time.time()
        probe = LLM(provider=self.llm.provider, endpoint=self.llm.endpoint, model=self.llm.model,
                    api_key=self.llm.api_key, mode="live", timeout=20)
        try:
            content = probe.transport(probe.body("你是连接测试。只输出 JSON。", '返回 {"ok": true}'))
            ok = json.loads(content).get("ok") is True
            self.llm.last_usage = probe.last_usage if hasattr(probe, "last_usage") else None
        except (LLMError, ValueError) as exc:
            return {"ok": False, "error": friendly_error(str(exc))}
        return {"ok": ok, "seconds": round(time.time() - started, 2), "model": self.llm.model,
                "usage": getattr(self.llm, "last_usage", None)}

    def settings_models(self, payload):
        """Model ids for the form as typed; nothing is saved. A saved key is only used for its own endpoint."""
        v = settings.validate(dict(payload, mode="replay"), settings.current())
        if not v["api_key"]:
            raise ValueError("先填 key（换了接口类型或地址时要重新填）")
        probe = LLM(provider=v["provider"], endpoint=v["endpoint"], model=v["model"],
                    api_key=v["api_key"], mode="live", timeout=20)
        try:
            return {"ok": True, "models": probe.list_models()}
        except LLMError as exc:
            return {"ok": False, "error": friendly_error(str(exc))}

    def eval_view(self):
        return evaluate(self.kb)

    def baseline_view(self):
        p = ROOT / "eval" / "baseline_run.json"
        if not p.exists():
            raise KeyError("还没有运行对照实验：python3 tools/run_baseline.py")
        data = json.loads(p.read_text(encoding="utf-8"))
        names = {}
        for s in data["summary"].values():
            for label in s["red_by_label"]:
                rule = self.kb.all_rules_by_id.get(label.split(":", 1)[1]) if label.startswith("模型:") else None
                names[label] = rule["title_zh"] if rule else LABEL_ZH.get(label, label)
        return dict(data, label_names_zh=names)

    # ---------------------------------------------------------- red team (citation guard, no model call)
    def savings_view(self, payload=None):
        """Measured model cost and latency from the repo's records, plus editable example assumptions."""
        return savings.view((payload or {}).get("assumptions"))

    def redteam_preset(self):
        data = json.loads((ROOT / "data" / "redteam.json").read_text(encoding="utf-8"))
        offered = self.kb.rules_for(data["platform"], kinds=["llm"], market=data["market"])
        return dict(data, rules_offered=[{"id": r["id"], "title_zh": r.get("title_zh")} for r in offered])

    def redteam_run(self, payload):
        """Run each injected 'model finding' through the same guard the real review uses."""
        preset = self.redteam_preset()
        items = payload.get("findings")
        if items is None:
            items = [i["finding"] for i in preset["injections"]]
        if not isinstance(items, list) or len(items) > 50:
            raise ValueError("请提交一个列表（最多 50 条）")
        allowed = self.kb.rules_for(preset["platform"], kinds=["llm"], market=preset["market"])
        fields = {"reply": preset["reply"]}
        results = []
        for item in items:
            kept, dropped = checks.guard_model_findings([item], allowed, fields)
            reason = dropped[0]["reason_zh"] if dropped else "规则编号在白名单里，原文也在回复里找到了"
            rid = item.get("rule_id") if isinstance(item, dict) else None
            if dropped and rid in self.kb.rules and rid not in {r["id"] for r in allowed}:
                reason = f"{rid} 是真实规则，但不适用于这个平台/市场，审核员根本没拿到它"
            elif dropped and rid and rid not in self.kb.all_rules_by_id:
                reason = f"知识库里没有 {rid} 这条规则（编造的编号）"
            results.append({"item": item, "kept": bool(kept), "reason_zh": reason,
                            "finding": kept[0] if kept else None})
        return {"results": results, "kept": sum(r["kept"] for r in results), "dropped": sum(not r["kept"] for r in results)}

    # ---------------------------------------------------------- fair-ground game
    def play_challenges(self):
        data = json.loads((ROOT / "data" / "play.json").read_text(encoding="utf-8"))
        return [{k: c[k] for k in ("id", "title_zh", "platform", "hint_zh", "text")} for c in data["challenges"]]

    def play_check(self, payload):
        """Score taps against the code-rule findings for one challenge. No model call."""
        data = json.loads((ROOT / "data" / "play.json").read_text(encoding="utf-8"))
        c = next(x for x in data["challenges"] if x["id"] == payload["id"])
        product = self.kb.product(c["product_id"])
        findings = checks.run_rule_checks({c["field"]: c["text"]}, product, self.kb, c["platform"])
        low = c["text"].lower()
        taps = [tuple(t) for t in payload.get("taps", []) if isinstance(t, list) and len(t) == 2]
        out = []
        for f in findings:
            start = low.find(f["quote"].lower()) if f["quote"] else -1
            span = [start, start + len(f["quote"])] if start >= 0 else None
            hit = bool(span) and any(a < span[1] and b > span[0] for a, b in taps)
            out.append({"problem_zh": f["problem_zh"], "quote": f["quote"], "span": span, "found": hit,
                        "severity": f["severity"], "source": f["source"]})
        tappable = [o for o in out if o["span"]]
        return {"findings": out, "found": sum(o["found"] for o in tappable), "total": len(tappable)}

    def play_score(self, payload):
        name = re.sub(r"[^\w\u4e00-\u9fff ·-]", "", str(payload.get("name", "")))[:16].strip() or "匿名"
        entry = {"name": name, "found": int(payload.get("found", 0)), "total": int(payload.get("total", 0)),
                 "ts": time.strftime("%H:%M:%S")}
        with self.play_lock:
            board = self._read_scores()
            board.append(entry)
            (STATE / "scores.json").parent.mkdir(parents=True, exist_ok=True)
            (STATE / "scores.json").write_text(json.dumps(board[-500:], ensure_ascii=False), encoding="utf-8")
        return entry

    def _read_scores(self):
        p = STATE / "scores.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

    def play_leaderboard(self):
        rows = sorted(self._read_scores(), key=lambda e: (-e["found"], e["ts"]))
        return {"top": rows[:10], "players": len(rows), "lan_url": self.lan_url}

    def samples(self):
        d = STATIC / "samples"
        return sorted(p.name for p in d.glob("*.png")) if d.exists() else []

    def board_view(self):
        rows = self.board.snapshot(list(self.kb.products))
        for r in rows:
            r["has_image"] = self.board.image_path(r["product_id"]) is not None
        return {"channels": CHANNELS, "rows": rows, "samples": self.samples()}

    def board_cell(self, q):
        res = self.board.result(q["product"][0], q["channel"][0])
        if res is None:
            raise KeyError("这个格子还没有结果")
        return res

    def board_mark(self, payload):
        return self.board.mark_listed(payload["product_id"], payload["channel"], payload.get("listed", True))

    def board_csv(self):
        """One row per product and platform, ready to paste into a bulk-upload sheet."""
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["product_id", "product_name", "platform", "status", "risk", "red", "amber", "updated",
                    "title_or_hook", "bullets_or_script", "description_or_caption", "search_terms_or_hashtags"])
        snap = {r["product_id"]: r["cells"] for r in self.board.snapshot(list(self.kb.products))}
        for pid, product in self.kb.products.items():
            for ch in ("amazon_us", "tiktok_mx"):
                cell = snap[pid][ch]
                res = self.board.result(pid, ch) or {}
                c = res.get("content") or {}
                if ch == "amazon_us":
                    row = [c.get("title", ""), " | ".join(c.get("bullets") or []), c.get("description", ""), c.get("search_terms", "")]
                else:
                    row = [c.get("hook", ""), " | ".join(x.get("line", "") for x in c.get("script") or []), c.get("caption", ""), " ".join(c.get("hashtags") or [])]
                w.writerow([pid, product["name_en"], ch, cell.get("status"), cell.get("risk") or "", cell.get("red", ""),
                            cell.get("amber", ""), cell.get("updated", "")] + row)
        return buf.getvalue()

    def logs(self, limit=200):
        if not LOG_PATH.exists():
            return {"entries": []}
        lines = LOG_PATH.read_text(encoding="utf-8").splitlines()[-limit:]
        return {"entries": [json.loads(l) for l in lines if l.strip()]}


APP = None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(STATIC), **kw)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _cross_site(self):
        """Reject requests a web page on another site could forge (CSRF, DNS rebinding).

        Applies to everything except the fair-ground game: the Host must be this machine,
        an Origin (sent by browsers on cross-site requests) must be this machine too, and
        POST bodies must be JSON, which a cross-site page cannot send without a preflight
        that this server never answers."""
        if self.path.startswith("/api/play/") or not self.path.startswith("/api/"):
            return False
        local = re.compile(r"^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$")
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        bad = not local.match(host)
        if origin is not None and not re.match(r"^http://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$", origin):
            bad = True
        if self.command == "POST" and not (self.headers.get("Content-Type") or "").startswith("application/json"):
            bad = True
        if bad:
            self._json(403, {"error": "只接受本机页面发来的请求"})
        return bad

    def _lan_blocked(self):
        try:
            local = ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            local = False
        if local or LAN_ALLOWED.match(self.path):
            return False
        self._json(403, {"error": "局域网访问只开放找茬游戏页面"})
        return True

    def do_GET(self):
        if self._lan_blocked() or self._cross_site():
            return None
        url = urlparse(self.path)
        if url.path in ("/play", "/play/"):
            self.path = "/play.html"
            return super().do_GET()
        play = {"/api/play/challenges": APP.play_challenges, "/api/play/leaderboard": APP.play_leaderboard}
        if url.path in play:
            return self._json(200, play[url.path]())
        routes = {"/api/meta": APP.meta, "/api/kb": APP.kb_rules, "/api/logs": APP.logs, "/api/board": APP.board_view,
                  "/api/inbox": APP.inbox_view, "/api/eval": APP.eval_view, "/api/settings": APP.settings_view,
                  "/api/redteam": APP.redteam_preset, "/api/savings": APP.savings_view}
        if url.path in routes:
            return self._json(200, routes[url.path]())
        if url.path == "/api/baseline":
            try:
                return self._json(200, APP.baseline_view())
            except KeyError as exc:
                return self._json(404, {"error": str(exc)})
        if url.path == "/api/board/cell":
            try:
                return self._json(200, APP.board_cell(parse_qs(url.query)))
            except KeyError as exc:
                return self._json(404, {"error": str(exc)})
        if url.path == "/api/board/export.csv":
            raw = ("\ufeff" + APP.board_csv()).encode("utf-8")  # BOM so Excel opens UTF-8 correctly
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="tradedesk-listings.csv"')
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return None
        if url.path.startswith("/api/image/"):
            p = APP.board.image_path(url.path.rsplit("/", 1)[-1])
            if not p:
                return self._json(404, {"error": "没有主图"})
            raw = p.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}[p.suffix[1:]])
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
            return None
        return super().do_GET()

    def do_POST(self):
        if self._lan_blocked() or self._cross_site():
            return None
        routes = {"/api/play/check": APP.play_check, "/api/play/score": APP.play_score,
                  "/api/inbox/triage": APP.runner.triage, "/api/tasks/status": APP.task_status,
                  "/api/settings": APP.settings_save, "/api/settings/test": APP.settings_test,
                  "/api/settings/models": APP.settings_models,
                  "/api/redteam": APP.redteam_run,"/api/inquiry": APP.runner.inquiry, "/api/listing": APP.runner.listing,
                  "/api/check": APP.runner.check_text, "/api/image-check": APP.runner.image_check,
                  "/api/board/mark": APP.board_mark, "/api/savings": APP.savings_view}
        fn = routes.get(self.path)
        if not fn:
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
            return self._json(200, fn(payload))
        except LLMError as exc:
            return self._json(502, {"error": str(exc), "kind": "llm"})
        except (KeyError, ValueError) as exc:
            return self._json(400, {"error": f"输入有误：{exc}"})
        except Exception as exc:  # keep the demo alive, show the error
            traceback.print_exc()
            return self._json(500, {"error": repr(exc)})


def friendly_error(msg):
    """Turn transport errors into something a non-developer can act on."""
    hints = [(r"nodename|gaierror|Name or service not known|getaddrinfo", "找不到这个地址：检查接口地址有没有写错、电脑有没有联网"),
             (r"model_not_found|模型不存在|无可用渠道|model.{0,40}(not exist|not found|does not exist)",
              "模型名不对，或这个 key 的分组不能用它：点「查可用模型」从列表里选"),
             # Tokenhub answers an empty account with 403 INSUFFICIENT_BALANCE, so this goes before the 403 hint
             (r"HTTP 402|quota|余额|insufficient", "账户余额不足：key 是对的，但账户里没有额度，找主办方或现场技术组充值"),
             (r"HTTP 401|key 无效|AuthenticationError", "key 不对：重新完整复制 key（注意不要带空格）"),
             (r"HTTP 403", "这个 key 的分组没有这个模型的权限：点「查可用模型」换一个，或找现场技术组"),
             (r"HTTP 404", "地址不对：赛事 Tokenhub 填 https://api.tokenhubcloud.net/v1"),
             (r"HTTP 429|限流", "请求太频繁，稍等再试"),
             (r"timed out|timeout", "连接超时：网络慢或地址不可达"),
             (r"JSON", "连上了，但返回的不是 JSON：模型名可能不对，或这个接口不是 OpenAI 兼容格式")]
    for pattern, text in hints:
        if re.search(pattern, msg, re.I):
            return f"{text}（原始信息：{msg[:160]}）"
    return msg[:300]


def lan_ip():
    """The address phones on the same Wi-Fi can reach (no packet is sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def main():
    global APP
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--lan", action="store_true", help="游园会：开放到局域网（手机只能访问找茬页面）")
    args = ap.parse_args()
    APP = App()
    if args.lan:
        args.host = "0.0.0.0"
        APP.lan_url = f"http://{lan_ip()}:{args.port}/play"
        print(f"游园会找茬页面：{APP.lan_url}")
    print(f"TradeDesk 出海工作台 · http://{args.host}:{args.port} · {APP.llm.describe()} · "
          f"规则 {len(APP.kb.rules)}/{len(APP.kb.all_rules)} 条已核实")
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
