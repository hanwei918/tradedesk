"""Comparison experiment: the same 8 inquiries answered four ways, all measured by the same checks.

    TRADEDESK_MODE=record python3 tools/run_baseline.py     # calls the model for the two baseline arms
    TRADEDESK_MODE=replay python3 tools/run_baseline.py     # re-computes from the cache, no network

Writes app/eval/baseline_run.json, which the 评测 page shows.
"""

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("TRADEDESK_MODE", "record")

from tradedesk.compare import ARMS, summarize  # noqa: E402
from tradedesk.kb import KnowledgeBase  # noqa: E402
from tradedesk.llm import LLM  # noqa: E402
from tradedesk.workflows import Runner  # noqa: E402
from record_demo import fix_instruction  # noqa: E402

KEEP = ("check", "severity", "field", "quote", "context", "problem_zh", "source", "by", "evidence_zh")


def slim(r):
    return {"reply": r["reply"], "risk": r["risk"], "dropped": r.get("dropped", []),
            "findings": [{k: f[k] for k in KEEP if k in f} for f in r["findings"]]}


def main():
    kb = KnowledgeBase()
    runner = Runner(LLM(), kb, log_path=ROOT / "logs" / "baseline.jsonl")
    rows = {arm: [] for arm in ARMS}
    for q in kb.inquiries:
        for variant in ("plain", "with_facts"):
            r = runner.baseline({"inquiry_id": q["id"], "variant": variant})
            rows[variant].append(dict(slim(r), inquiry_id=q["id"]))
            print(f"{q['id']} {variant}: {r['risk']} red={sum(f['severity'] == 'red' for f in r['findings'])}")
        base = {"inquiry_text": q["text"], "intent_zh": q["intent_zh"], "product_id": q["product_id"]}
        r1 = runner.inquiry(dict(base, round=1))
        rows["tradedesk"].append(dict(slim(r1), inquiry_id=q["id"]))
        r2 = r1
        if r1["findings"]:
            r2 = runner.inquiry(dict(base, understanding=r1["understanding"], language=r1["language"],
                                     previous={"reply": r1["reply"], "internal_brief_zh": r1["internal_brief_zh"]},
                                     instruction_zh=fix_instruction(r1["findings"]), round=2))
        rows["tradedesk_fixed"].append(dict(slim(r2), inquiry_id=q["id"]))
        print(f"{q['id']} tradedesk: {r1['risk']} -> {r2['risk']}")
    out = {"recorded": time.strftime("%Y-%m-%d %H:%M"), "model": runner.llm.model, "provider": runner.llm.provider,
           "arms": ARMS, "baseline_ask_zh": Runner.BASELINE_ASK.strip(),
           "note_zh": "四组用同一把尺子测：同一套代码规则 + 同一个合规审核员（带出处守卫）。红色 = 明确违反资料卡或规则；黄色 = 需人工确认。",
           "summary": summarize(rows), "rows": rows,
           "inquiries": {q["id"]: {"label_zh": q["label_zh"], "language": q["language"]} for q in kb.inquiries}}
    path = ROOT / "eval" / "baseline_run.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out["summary"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
