"""Salesperson feedback on each reply, and the metrics computed from it.

TradeDesk never sends anything. After a salesperson has dealt with a draft they record what really
happened: sent as is, edited and then sent, or not used; which findings helped and which were false
alarms; what the product card was missing; how long it took. The 使用度量 tab is computed from these
records only. Nothing is seeded, so an empty log shows an empty page, never example numbers.
"""

import csv
import difflib
import io
import json
import re
import threading
import time
from pathlib import Path
from statistics import median

OUTCOMES = {"as_is": "原样发出", "edited": "改后发出", "unused": "没用这版"}
VERDICTS = {"useful": "有用", "false_alarm": "误报"}
MISSING = ["交期", "价格", "认证", "MOQ", "样品", "付款", "包装定制", "物流条款", "其他"]
MAX_TEXT = 8000
FEW = 10  # below this many records the page says the numbers only show a direction

# CJK and kana one character at a time (no spaces to split on), other letters and digits as words
CJK = "\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af"
TOKEN = re.compile(f"[{CJK}]|[^\\W_{CJK}]+|[^\\w\\s]")


def edit_stats(draft, sent):
    """How much of the draft the salesperson changed: changed tokens / draft tokens, at most 1."""
    a, b = TOKEN.findall(draft or ""), TOKEN.findall(sent or "")
    changed = sum(max(i2 - i1, j2 - j1)
                  for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes()
                  if tag != "equal")
    return {"draft_tokens": len(a), "changed_tokens": changed,
            "ratio": round(min(1.0, changed / len(a)), 3) if a else (0.0 if not b else 1.0)}


def _text(payload, key, required=False):
    value = payload.get(key)
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError(f"{key} 要是文字")
    value = value.strip()
    if required and not value:
        raise ValueError({"draft": "缺少 TradeDesk 生成的回复", "sent": "改后发出要填实际发出的版本"}.get(key, f"缺少 {key}"))
    if len(value) > MAX_TEXT:
        raise ValueError(f"{key} 太长（最多 {MAX_TEXT} 字）")
    return value


def _verdicts(items):
    if items is None:
        return []
    if not isinstance(items, list) or len(items) > 50:
        raise ValueError("提示判断要是列表（最多 50 条）")
    out = []
    for v in items:
        if not isinstance(v, dict) or v.get("verdict") not in VERDICTS:
            raise ValueError("每条提示只能判“有用”或“误报”")
        key = str(v.get("key") or "").strip()[:60]
        if not key:
            raise ValueError("提示缺少规则编号或出处")
        out.append({"key": key, "label": str(v.get("label") or "")[:80], "verdict": v["verdict"],
                    "severity": "red" if v.get("severity") == "red" else "amber",
                    "by": "model" if v.get("by") == "model" else "code"})
    return out


class FeedbackLog:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()

    def load(self):
        return json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else []

    def _write(self, items):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    def add(self, payload):
        outcome = payload.get("outcome")
        if outcome not in OUTCOMES:
            raise ValueError("处理结果只能是：" + "、".join(OUTCOMES.values()))
        draft = _text(payload, "draft", required=True)
        if outcome == "as_is":
            sent = draft
        elif outcome == "edited":
            sent = _text(payload, "sent", required=True)
            if sent == draft:
                raise ValueError("选了“改后发出”，但内容和 TradeDesk 的版本一样：没改就选“原样发出”")
        else:
            sent = ""
        missing = payload.get("missing") or []
        if not isinstance(missing, list) or any(m not in MISSING for m in missing):
            raise ValueError("资料卡缺的信息只能从这些里选：" + "、".join(MISSING))
        minutes = payload.get("minutes")
        if minutes not in (None, ""):
            try:
                minutes = float(minutes)
            except (TypeError, ValueError):
                raise ValueError("用时要填数字（分钟）") from None
            if not 0.1 <= minutes <= 600:
                raise ValueError("用时要在 0.1 到 600 分钟之间")
            minutes = round(minutes, 1)
        else:
            minutes = None
        try:
            rnd = int(payload.get("round") or 1)
        except (TypeError, ValueError):
            raise ValueError("轮次要是整数") from None
        entry = {"ts": time.strftime("%Y-%m-%d %H:%M"), "outcome": outcome,
                 "inquiry_id": str(payload.get("inquiry_id") or "")[:20], "run_id": str(payload.get("run_id") or "")[:12],
                 "product_id": str(payload.get("product_id") or "")[:40], "market": str(payload.get("market") or "")[:8],
                 "round": rnd, "risk": payload.get("risk") if payload.get("risk") in ("red", "amber", "green") else None,
                 "draft": draft, "sent": sent, "edit": edit_stats(draft, sent) if outcome == "edited" else None,
                 "verdicts": _verdicts(payload.get("verdicts")), "missing": list(dict.fromkeys(missing)),
                 "minutes": minutes, "note": _text(payload, "note")[:200]}
        with self.lock:
            items = self.load()
            items.append(entry)
            self._write(items)
        return entry

    def delete(self, index):
        with self.lock:
            items = self.load()
            if not isinstance(index, int) or not 0 <= index < len(items):
                raise ValueError("没有这条记录")
            del items[index]
            self._write(items)

    def summary(self):
        items = self.load()
        n = len(items)
        count = {k: sum(1 for e in items if e["outcome"] == k) for k in OUTCOMES}
        share = lambda k: round(count[k] / n, 3) if n else None
        ratios = [e["edit"]["ratio"] for e in items if e.get("edit")]
        minutes = [e["minutes"] for e in items if e.get("minutes") is not None]
        rounds = [e["round"] for e in items]
        rules = {}
        for e in items:
            for v in e["verdicts"]:
                r = rules.setdefault(v["key"], {"key": v["key"], "label": v["label"], "useful": 0, "false_alarm": 0})
                r[v["verdict"]] += 1
                r["label"] = r["label"] or v["label"]
        for r in rules.values():
            r["useful_rate"] = round(r["useful"] / (r["useful"] + r["false_alarm"]), 3)
        judged_useful = sum(r["useful"] for r in rules.values())
        judged = judged_useful + sum(r["false_alarm"] for r in rules.values())
        missing = {}
        for e in items:
            for m in e["missing"]:
                missing[m] = missing.get(m, 0) + 1
        return {
            "n": n, "few": n < FEW, "few_threshold": FEW,
            "outcomes": {k: {"label": OUTCOMES[k], "n": count[k], "share": share(k)} for k in OUTCOMES},
            "adopted_share": round((count["as_is"] + count["edited"]) / n, 3) if n else None,
            "edit_ratio_median": round(median(ratios), 3) if ratios else None, "edit_n": len(ratios),
            "minutes_median": round(median(minutes), 1) if minutes else None, "minutes_n": len(minutes),
            "rounds_median": median(rounds) if rounds else None,
            "findings_judged": judged, "findings_useful_rate": round(judged_useful / judged, 3) if judged else None,
            "rules": sorted(rules.values(), key=lambda r: (-r["false_alarm"], r["useful_rate"], r["key"])),
            "missing": [{"item": k, "n": v} for k, v in sorted(missing.items(), key=lambda kv: (-kv[1], MISSING.index(kv[0])))],
            "records": [dict(e, index=i) for i, e in enumerate(items)][::-1],
            "missing_options": MISSING, "outcome_labels": OUTCOMES,
        }

    def csv(self):
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["时间", "询盘", "产品", "市场", "轮次", "风险", "处理", "改动比例", "用时(分钟)",
                    "有用的提示", "误报的提示", "资料卡缺", "备注", "TradeDesk 版本", "实际发出"])
        for e in self.load():
            pick = lambda verdict: "；".join(v["key"] for v in e["verdicts"] if v["verdict"] == verdict)
            w.writerow([e["ts"], e["inquiry_id"], e["product_id"], e["market"], e["round"], e["risk"] or "",
                        OUTCOMES[e["outcome"]], e["edit"]["ratio"] if e.get("edit") else "",
                        e["minutes"] if e["minutes"] is not None else "", pick("useful"), pick("false_alarm"),
                        "；".join(e["missing"]), e["note"], e["draft"], e["sent"]])
        return buf.getvalue()
