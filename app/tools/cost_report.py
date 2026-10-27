"""Model cost per inquiry (workflow A), from the call log.

    python3 tools/record_demo.py      # fills logs/calls.jsonl (replay mode costs nothing)
    python3 tools/cost_report.py      # writes app/eval/cost_run.json

Token counts are what the model reported when the demo was recorded; replays re-read them from the cache.
"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tradedesk.cost import PRICES, inquiry_runs, summarize  # noqa: E402
from tradedesk.kb import KnowledgeBase  # noqa: E402


def main():
    log = ROOT / "logs" / "calls.jsonl"
    if not log.exists():
        sys.exit("没有调用日志：先运行 python3 tools/record_demo.py")
    rows = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line.strip()]
    per = inquiry_runs(rows, KnowledgeBase().inquiries)
    unmatched = len(per.pop(None, {}).get("round1", []))
    out = {
        "computed": time.strftime("%Y-%m-%d %H:%M"),
        "prices_usd_per_mtok": {m: {"input": p[0], "output": p[1]} for m, p in PRICES.items()},
        "note_zh": "工作流 A：第 1 轮 = 理解询盘 + 生成回复 + 合规审核（3 次调用）；改一轮 = 生成回复 + 合规审核（2 次调用）。"
                   "token 数是录制演示时模型返回的真实用量，输出 token 含思考过程。价格按 Anthropic 官方价目表；现场换成 Tokenhub 的模型后价格不同。",
        "summary": summarize(per),
        "unmatched_runs": unmatched,
        "inquiries": dict(sorted(per.items())),
    }
    (ROOT / "eval" / "cost_run.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out["summary"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
