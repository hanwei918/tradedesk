"""Preview or record offline listing requests in small, explicit batches.

Run from app/: python tools/warm_listing_cache.py --help
The default action is a cost/workload preview. Add --execute to call the model.
"""

import argparse
import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tradedesk.board import Board
from tradedesk.kb import KnowledgeBase
from tradedesk.listing_catalog import LANGUAGES, LISTING_PLATFORMS
from tradedesk.llm import LLM, LLMError
from tradedesk.workflows import Runner


def choices(parser, name, options):
    parser.add_argument("--" + name, action="append", choices=options,
                        help="可重复指定；省略时预览全部")


def main():
    parser = argparse.ArgumentParser(description="分批录制多平台上架的离线回放缓存")
    parser.add_argument("--product", action="append", help="产品 ID，可重复；默认全部产品")
    choices(parser, "platform", LISTING_PLATFORMS)
    choices(parser, "language", LANGUAGES)
    parser.add_argument("--execute", action="store_true", help="实际调用当前模型并写入缓存，可能产生费用")
    args = parser.parse_args()

    kb = KnowledgeBase()
    products = {p["id"]: p for p in kb.products.values()}
    product_ids = args.product or list(products)
    platforms = args.platform or list(LISTING_PLATFORMS)
    languages = args.language or list(LANGUAGES)
    unknown_products = [p for p in product_ids if p not in products]
    if unknown_products:
        parser.error(f"未知产品 ID: {unknown_products[0]}（可用: {', '.join(products)}）")
    if args.execute and not (args.product and args.platform and args.language):
        parser.error("执行时请明确指定 --product、--platform、--language，建议一次预热少量组合")

    targets = [(pid, platform, language)
               for pid in product_ids for platform in platforms for language in languages]
    review_targets = sum(bool(kb.rules_for(platform, kinds=["llm"]))
                         for _, platform, _ in targets)
    max_calls = len(targets) + review_targets
    print(f"目标组合: {len(targets)}")
    print(f"最多模型请求: {max_calls}（生成 {len(targets)} + 适用平台的模型审核 {review_targets}）")
    print("缓存按完整请求匹配；现有缓存命中时不会产生对应模型请求。")
    if not args.execute:
        print("当前仅为预览，没有联网或修改缓存。选择小批量并加 --execute 后才会调用模型。")
        return 0

    llm = LLM(mode="record")
    if not llm.api_key:
        print("未配置当前模型 API key；请在应用的模型设置中配置后再执行。", file=sys.stderr)
        return 2
    print(f"开始录制: {llm.provider} / {llm.model}。可随时中断，已完成的缓存会保留。")
    done = 0
    with tempfile.TemporaryDirectory(prefix="tradedesk-cache-warm-") as temp:
        runner = Runner(llm, kb, log_path=Path(temp) / "calls.jsonl",
                        board=Board(Path(temp) / "state"))
        for pid, platform, language in targets:
            try:
                result = runner.listing({"product_id": pid, "platforms": [platform],
                                         "languages": {platform: language}, "round": 1})
            except (LLMError, KeyError, ValueError) as exc:
                print(f"中止于 {pid} / {platform} / {language}: {exc}", file=sys.stderr)
                print(f"已完成组合: {done}；这些请求的缓存已保留。", file=sys.stderr)
                return 1
            review_skipped = result["platforms"][platform].get("review_skipped")
            if review_skipped:
                print(f"审核缓存未录制，已中止于 {pid} / {platform} / {language}: "
                      f"{review_skipped['reason_zh']}", file=sys.stderr)
                print(f"生成缓存已保留；已完成组合: {done}。", file=sys.stderr)
                return 1
            done += 1
            print(f"[{done}/{len(targets)}] {pid} / {platform} / {language} "
                  f"({result['platforms'][platform]['risk']})")
    print("录制完成。恢复 TRADEDESK_MODE=replay 后，可离线回放已覆盖的首轮组合。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
