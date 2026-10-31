"""Record the replay cache for the second demo factory (宁海杯壶 · 500ml tumbler).

    python3 tools/record_second_factory.py             # preview: which requests are missing, no network
    python3 tools/record_second_factory.py --execute   # call the model for the missing ones and cache them

The requests are exactly what the page sends: listing on Amazon US + TikTok MX, the
check-page sample for this product, and round 1 of inquiry INQ-US-06. Runs against a
temporary state folder, so the local board and inbox are not touched.
"""

import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tradedesk.board import Board  # noqa: E402
from tradedesk.kb import KnowledgeBase  # noqa: E402
from tradedesk.llm import LLM, LLMError  # noqa: E402
from tradedesk.workflows import Runner  # noqa: E402

PRODUCT = "TMB-50V"
INQUIRY = "INQ-US-06"


def requests(kb):
    sample = json.loads((ROOT / "data" / "check_samples.json").read_text(encoding="utf-8"))["samples"][PRODUCT]
    q = next(x for x in kb.inquiries if x["id"] == INQUIRY)
    return [
        ("上架 Amazon 美国站 + TikTok 墨西哥", "listing",
         {"product_id": PRODUCT, "platforms": ["amazon_us", "tiktok_mx"], "languages": {"amazon_us": "en", "tiktok_mx": "es"}, "round": 1}),
        ("文案体检示例", "check_text", {"platform": "amazon_us", "product_id": PRODUCT, "text": sample}),
        ("询盘 INQ-US-06 第 1 轮", "inquiry",
         {"inquiry_text": q["text"], "intent_zh": q["intent_zh"], "product_id": PRODUCT, "inquiry_id": INQUIRY, "round": 1}),
    ]


def run(llm, kb):
    with tempfile.TemporaryDirectory() as t:
        runner = Runner(llm, kb, log_path=Path(t) / "calls.jsonl", board=Board(Path(t) / "state"))
        for label, method, payload in requests(kb):
            try:
                r = getattr(runner, method)(payload)
            except LLMError as exc:
                print(f"缺回放 · {label}：{exc}")
                continue
            parts = r["platforms"].values() if "platforms" in r else [r]
            skipped = [p for p in parts if p.get("review_skipped")]
            sources = [t["meta"]["source"] for t in r["trace"]]
            print(f"{'缺回放' if skipped else '好了'} · {label}：{len(sources)} 次模型步骤（{', '.join(sources)}）"
                  + "".join(f"；{p.get('platform_name', '')} 风险 {p['risk']}，{len(p['findings'])} 条提示" for p in parts))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="联网调用当前模型，录下缺的回放（会产生费用）")
    args = ap.parse_args()
    kb = KnowledgeBase()
    live = LLM(mode="record")
    print(f"模型：{live.provider} · {live.model}")
    print("预览（只读缓存，不联网）：")
    run(LLM(provider=live.provider, endpoint=live.endpoint, model=live.model, api_key="", mode="replay"), kb)
    if args.execute:
        print("录制：")
        run(live, kb)


if __name__ == "__main__":
    main()
