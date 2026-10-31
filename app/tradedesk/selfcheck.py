"""开摊自检: before the booth opens, replay every request the demo paths make.

`run` replays each step offline against a throwaway state folder and reports which
steps have a recorded answer. `warm` replays the same steps into the real board,
inbox and call log, so a freshly unzipped package shows history on the overview.
Neither ever calls the network, whatever mode the app is in.
"""

import base64
import json
import sys
import tempfile
import time
from pathlib import Path

from .board import Board
from .llm import LLM, LLMError
from .workflows import Runner

ROOT = Path(__file__).resolve().parent.parent
FIX_ALL = "按风险提示全部修改"
IMAGE_SAMPLES = [("KET-17S", "KET-17S_main.png"), ("KET-17S", "KET-17S_bad.png"),
                 ("AF-45D", "AF-45D_main.png"), ("BL-35P", "BL-35P_main.png")]


def check_samples():
    return json.loads((ROOT / "data" / "check_samples.json").read_text(encoding="utf-8"))["samples"]


def fix_inquiry(findings):
    # Same text the page sends for the “按风险提示全部修改” chip (app.js fixInstruction).
    return FIX_ALL + "\n风险提示：\n" + "\n".join(
        f"{i + 1}. {f['problem_zh']}（原文：{f['quote']}）建议：{f['suggestion_zh']}" for i, f in enumerate(findings))


def steps(kb):
    """(path, step, fn(runner) -> list of results). Mirrors the role lanes in app.js."""
    def inquiry(qid, rounds):
        def fn(r):
            q = next(x for x in kb.inquiries if x["id"] == qid)
            base = {"inquiry_text": q["text"], "intent_zh": q["intent_zh"], "product_id": q["product_id"], "inquiry_id": qid}
            r1 = r.inquiry(dict(base, round=1))
            if rounds < 2 or not r1["findings"]:
                return [r1]
            return [r1, r.inquiry(dict(base, understanding=r1["understanding"], language=r1["language"],
                                       previous={"reply": r1["reply"], "internal_brief_zh": r1["internal_brief_zh"]},
                                       instruction_zh=fix_inquiry(r1["findings"]), round=2))]
        return fn

    def listing(pid, platforms):
        return lambda r: [r.listing({"product_id": pid, "platforms": platforms, "round": 1})]

    def check(pid):
        return lambda r: [r.check_text({"platform": "amazon_us", "product_id": pid, "text": check_samples()[pid]})]

    def image(pid, name):
        def fn(r):
            url = "data:image/png;base64," + base64.b64encode((ROOT / "static" / "samples" / name).read_bytes()).decode()
            return [r.image_check({"product_id": pid, "image": url, "name": name})]
        return fn

    demo = {card["id"]: card for card in kb.catalog.get("products", [])}  # products added in the app have no recordings
    default = next(p for p, card in demo.items() if "factory_id" not in card)
    other = [p for p, card in demo.items() if "factory_id" in card]
    out = [
        ("商户线", "收件箱排优先级（全部示例询盘）",
         lambda r: [r.triage({"inquiry_ids": [q["id"] for q in kb.inquiries if not q.get("imported")]})]),
        ("商户线", "回复 INQ-US-01，改出第 2 轮", inquiry("INQ-US-01", 2)),
        ("商户线", "附上 Amazon 美国站文案", listing(default, ["amazon_us"])),
        ("合规审查员线", "文案体检示例", check(default)),
        ("消费者线", "美国、墨西哥的商品页", listing(default, ["amazon_us", "tiktok_mx"])),
        ("消费者线", "德国站、Mercado Libre 的商品页", listing(default, ["amazon_de", "mercadolibre_mx"])),
    ]
    out += [("商品看板", f"主图检查 {name}", image(pid, name)) for pid, name in IMAGE_SAMPLES
            if (ROOT / "static" / "samples" / name).exists()]
    for pid in other:
        out += [("换一家工厂", f"{kb.product(pid)['name_zh']} · 上架", listing(pid, ["amazon_us", "tiktok_mx"])),
                ("换一家工厂", f"{kb.product(pid)['name_zh']} · 文案体检", check(pid))]
        out += [("换一家工厂", f"询盘 {q['id']}", inquiry(q["id"], 1)) for q in kb.inquiries if q["product_id"] == pid and not q.get("imported")]
    return out


def _replay(llm):
    return LLM(provider=llm.provider, endpoint=llm.endpoint, model=llm.model, api_key="", mode="replay",
               cache_dir=llm.cache_dir)


def _run_steps(runner, kb):
    rows = []
    for path, step, fn in steps(kb):
        started = time.time()
        try:
            results = fn(runner)
        except LLMError as exc:
            rows.append({"path": path, "step": step, "ok": False, "reason_zh": str(exc).split("：")[0]})
            continue
        model_steps, skipped = 0, []
        for res in results:
            model_steps += sum(len(t["trace"]) for t in res["triaged"]) if "triaged" in res else len(res["trace"])
            parts = list(res["platforms"].values()) if "platforms" in res else [res]
            skipped += [p["review_skipped"] for p in parts if p.get("review_skipped")] + res.get("failed", [])
        rows.append({"path": path, "step": step, "ok": not skipped, "model_steps": model_steps,
                     "seconds": round(time.time() - started, 2),
                     "reason_zh": skipped[0]["reason_zh"].split("：")[0] if skipped else ""})
    return rows


def run(kb, llm, state_dir, settings_view=None):
    with tempfile.TemporaryDirectory() as t:
        runner = Runner(_replay(llm), kb, log_path=Path(t) / "calls.jsonl", board=Board(Path(t) / "state"))
        rows = _run_steps(runner, kb)
    state_dir = Path(state_dir)
    writable = True
    try:
        state_dir.mkdir(parents=True, exist_ok=True)
        probe = state_dir / ".selfcheck"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except OSError:
        writable = False
    board_results = len(list((state_dir / "results").glob("*.json"))) if (state_dir / "results").exists() else 0
    log = ROOT / "logs" / "calls.jsonl"
    runs = len({json.loads(l).get("run_id") for l in log.read_text(encoding="utf-8").splitlines() if l.strip()}) if log.exists() else 0
    source_check = ROOT / "kb" / "source_check.json"
    sc = json.loads(source_check.read_text(encoding="utf-8")) if source_check.exists() else None
    env = [
        {"item": "回放覆盖", "ok": all(r["ok"] for r in rows),
         "detail_zh": f"{sum(r['ok'] for r in rows)} / {len(rows)} 步有录好的结果，回放模式下离线可走"},
        {"item": "模型模式", "ok": llm.mode == "replay",
         "detail_zh": {"replay": "回放（不联网）：摊位推荐用这个", "record": "实时 + 录制：每步要联网等 20 秒以上",
                       "live": "实时：每步要联网等 20 秒以上，摊位建议切到回放"}.get(llm.mode, llm.mode)},
        {"item": "key", "ok": True, "info": True,
         "detail_zh": "已配置（不显示内容）" if llm.api_key else "没有配置：回放模式不需要；要演示实时调用时在左下角模型卡片里填"},
        {"item": "知识库", "ok": len(kb.rules) == len(kb.all_rules),
         "detail_zh": f"{len(kb.rules)} / {len(kb.all_rules)} 条规则已核实可用"},
        {"item": "规则出处自检", "ok": bool(sc), "info": not sc,
         "detail_zh": (f"{sc['checked_at']} 抓取：{sc['summary']['found']} 条原文仍在官方页面，"
                       f"{sc['summary']['browser']} 条需人工打开核对（脚本页面 / PDF），{sc['summary']['blocked']} 条网站拒绝程序抓取，"
                       f"{sc['summary']['missing']} 条没找到")
         if sc else "还没跑过：python3 tools/check_rule_sources.py"},
        {"item": "本地数据目录", "ok": writable, "detail_zh": "可写" if writable else f"{state_dir} 不可写：看板和收件箱存不下来"},
        {"item": "演示历史", "ok": runs > 0 and board_results > 0, "info": True,
         "detail_zh": f"调用日志 {runs} 次运行、看板 {board_results} 个格子有结果"
                      + ("" if runs and board_results else "：新解压的包是空的，点“一键预热”把演示路径回放一遍")},
        {"item": "Python", "ok": sys.version_info >= (3, 9), "detail_zh": sys.version.split()[0]},
    ]
    return {"checked_at": time.strftime("%Y-%m-%d %H:%M:%S"), "mode": llm.mode, "model": llm.model,
            "ok": all(e["ok"] or e.get("info") for e in env), "env": env, "steps": rows}


def warm(kb, llm, board, inbox, log_path):
    """Replay the demo paths into the real board, inbox and log (offline)."""
    runner = Runner(_replay(llm), kb, log_path=log_path, board=board, inbox=inbox)
    rows = _run_steps(runner, kb)
    return {"warmed": sum(r["ok"] for r in rows), "total": len(rows), "steps": rows}
