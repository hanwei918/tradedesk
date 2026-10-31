"""Export the agent / workflow / knowledge-base configuration as one JSON file.

    python3 tools/export_config.py   ->  config/agents.json

This is the "平台配置导出" deliverable: every role with its full prompt, the workflows
step by step, the knowledge base binding and the model settings. The same document is
shown in the app on the 智能体配置 page (tradedesk/config_export.py builds both).
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tradedesk.config_export import build  # noqa: E402
from tradedesk.kb import KnowledgeBase  # noqa: E402
from tradedesk.llm import LLM  # noqa: E402


def main():
    kb = KnowledgeBase()
    out = build(kb, LLM(api_key="", mode="replay"))
    path = ROOT / "config" / "agents.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}: {len(out['agents'])} agents, {len(out['workflows'])} workflows, "
          f"{len(kb.rules)}/{len(kb.all_rules)} rules verified")


if __name__ == "__main__":
    main()
