"""Re-fetch every rule's source page and check that its verbatim excerpt is still there.

    python3 tools/check_rule_sources.py      ->  kb/source_check.json (shown on the 规则知识库 page)

Needs internet, makes no model call. Pages behind a captcha or rendered by JavaScript are
reported as such; they were verified by hand in a browser (date in each rule's "fetched").
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tradedesk import sources  # noqa: E402
from tradedesk.kb import KnowledgeBase  # noqa: E402


def main():
    kb = KnowledgeBase()
    report = sources.save(sources.check_all(kb.all_rules))
    for r in report["results"]:
        if r["status"] != "found":
            print(f"{r['id']:8} {sources.STATUS_ZH[r['status']]:12} HTTP {r.get('http', '-')}  {r['url']}")
    s = report["summary"]
    print(f"{report['checked_at']} · {report['total']} 条：原文仍在 {s['found']}，需人工打开核对 {s['browser']}，"
          f"网站拒绝程序抓取 {s['blocked']}，没找到 {s['missing']}，抓取失败 {s['error']}（{report['seconds']} 秒）")


if __name__ == "__main__":
    main()
