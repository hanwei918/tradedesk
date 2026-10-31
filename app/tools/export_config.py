"""Export the agent / workflow / knowledge-base configuration as one JSON file.

    python3 tools/export_config.py   ->  config/agents.json

This is the "平台配置导出" deliverable: every role with its full prompt, the two
workflows step by step, the knowledge base binding and the model settings.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tradedesk.kb import KnowledgeBase, PLATFORM_NAMES  # noqa: E402
from tradedesk.listing_catalog import LANGUAGES, LISTING_PLATFORMS  # noqa: E402
from tradedesk.llm import LLM  # noqa: E402
from tradedesk.workflows import ROLES  # noqa: E402

AGENTS = [
    {"id": "analyst", "prompt": "understand_inquiry", "task_zh": "读询盘，抽取买家画像、需求、质量信号、与工厂资料的冲突；每条带询盘原文出处",
     "interaction_zh": "收到新询盘时自动触发；结果显示在“询盘分析”面板"},
    {"id": "sales", "prompt": "reply_inquiry", "task_zh": "用买家语言写阿里国际站 RFQ 回复 + 给采购/生产的中文内部备忘",
     "interaction_zh": "多轮：业务员用中文提修改意见，在上一版基础上改"},
    {"id": "ops_amazon", "prompt": "listing_amazon", "task_zh": "中文产品资料 → Amazon 美国站英文 Listing",
     "interaction_zh": "多轮：运营用中文提修改意见"},
    {"id": "ops_tiktok", "prompt": "listing_tiktok", "task_zh": "中文产品资料 → TikTok Shop 墨西哥西语种草脚本",
     "interaction_zh": "多轮：运营用中文提修改意见"},
    {"id": "image_reviewer", "prompt": "vision_review", "task_zh": "看主图，按“模型判断”类主图规则（文字宣称、徽章、道具、是否实拍、只出现一次）审核；必须写出看到了什么",
     "interaction_zh": "在商品看板上传或选择主图后触发；像素指标由代码先测量"},
    {"id": "compliance", "prompt": "compliance_review", "task_zh": "按知识库中“模型判断”类规则审核文本；必须给出规则编号和原文片段，否则被代码丢弃",
     "interaction_zh": "每次生成后自动触发"},
]

WORKFLOWS = [
    {"id": "D", "name_zh": "询盘收件箱 + 跨岗位任务", "trigger_zh": "整理收件箱 / 处理询盘",
     "steps": [
         {"step_zh": "理解每条询盘（与工作流 A 共用同一步）", "agent": "analyst", "guard_zh": "无询盘原文出处的条目丢弃"},
         {"step_zh": "优先级打分（代码）", "agent": None, "detail_zh": "50 + 正面信号×8 − 负面信号×8 − 硬冲突×6 − 待确认×3 + 数量加分，限制 0–100"},
         {"step_zh": "回复时派发任务", "agent": "sales", "guard_zh": "岗位必须是 采购/生产/美工/运营/业务，quote 必须在询盘原文里"},
         {"step_zh": "任务状态流转", "agent": None, "detail_zh": "待处理 → 进行中 → 已完成"},
     ]},
    {"id": "C", "name_zh": "商品看板 · 批量上品 + 主图检查", "trigger_zh": "批量生成 / 上传主图 / 标记上架",
     "steps": [
         {"step_zh": "批量生成：对选中产品逐个跑工作流 B（Amazon + TikTok）", "agent": "ops_amazon / ops_tiktok / compliance"},
         {"step_zh": "主图像素测量（代码）", "agent": None, "detail_zh": "最长边、四周白色比例、产品占比、是否贴边；背景不是白色时不估算占比和贴边"},
         {"step_zh": "主图看图审核", "agent": "image_reviewer", "guard_zh": "规则编号不在白名单、没写看到了什么 → 丢弃"},
         {"step_zh": "状态流转", "agent": None, "detail_zh": "未生成 → 不能发/需人工确认/可上架 → 已上架（人工标记；红色时代码拒绝）"},
         {"step_zh": "导出 CSV", "agent": None},
     ]},
    {"id": "A", "name_zh": "询盘回复", "trigger_zh": "收到新询盘 / 业务员修改意见",
     "steps": [
         {"step_zh": "理解询盘", "agent": "analyst", "guard_zh": "丢弃在询盘原文里找不到 quote 的条目"},
         {"step_zh": "生成回复（买家语言）+ 内部备忘（中文）", "agent": "sales", "kb_zh": "注入 alibaba_rfq 平台的规则摘要"},
         {"step_zh": "规则校验", "agent": None, "detail_zh": "产品事实（认证、材料、价格、MOQ、交期、付款）+ 合同条款 + 知识库正则/长度规则"},
         {"step_zh": "模型审核", "agent": "compliance", "guard_zh": "规则编号不在白名单、原文片段对不上 → 丢弃"},
         {"step_zh": "反馈", "agent": None, "detail_zh": "原文高亮批注 + 红黄绿风险等级 + 与上一轮的逐词对比"},
     ]},
    {"id": "B", "name_zh": "多平台上架", "trigger_zh": "新品上架 / 运营修改意见",
     "steps": [
         {"step_zh": "选上架平台（11 个）和每个平台的输出语言（6 种）", "agent": None,
          "detail_zh": "默认 Amazon 美国站英语 + TikTok 墨西哥西语；其他平台的生成角色和提示词见 listing_agents"},
         {"step_zh": "生成 Amazon 美国站 Listing（英语）", "agent": "ops_amazon", "kb_zh": "注入 amazon_us 规则摘要"},
         {"step_zh": "生成 TikTok 墨西哥种草脚本（西语）", "agent": "ops_tiktok", "kb_zh": "注入 tiktok_mx 规则摘要"},
         {"step_zh": "规则校验 + 模型审核（按平台分别进行）", "agent": "compliance"},
         {"step_zh": "反馈", "agent": None, "detail_zh": "逐字段高亮 + 风险等级 + 前后对比"},
     ]},
]


def main():
    kb = KnowledgeBase()
    llm = LLM(api_key="", mode="replay")
    out = {
        "app": "TradeDesk 出海工作台",
        "model": {"endpoint": llm.endpoint, "model": llm.model, "temperature": 0, "seed": 42,
                  "response_format": "json_object", "modes": ["live", "record", "replay"]},
        "agents": [dict(a, role_zh=ROLES[a["id"]],
                        prompt_file=f"prompts/{a['prompt']}.md",
                        prompt_text=(ROOT / "prompts" / f"{a['prompt']}.md").read_text(encoding="utf-8"))
                   for a in AGENTS],
        "listing_agents": [{"platform": pid, "platform_name": c["name"], "role": c["role"], "role_zh": ROLES[c["role"]],
                            "default_language": c["default_language"],
                            "rules": [r["id"] for r in kb.rules_for(pid)],
                            "prompt_file": f"prompts/{c['prompt']}.md",
                            "prompt_text": (ROOT / "prompts" / f"{c['prompt']}.md").read_text(encoding="utf-8")}
                           for pid, c in LISTING_PLATFORMS.items()],
        "listing_languages": {k: v["name"] for k, v in LANGUAGES.items()},
        "workflows": WORKFLOWS,
        "platforms": PLATFORM_NAMES,
        "knowledge_base": {
            "file": "kb/rules.json", "version": kb.version,
            "rules_total": len(kb.all_rules), "rules_verified": len(kb.rules),
            "by_category": {},
            "check_map": kb.check_map,
            "product_cards": "data/products.json",
        },
    }
    for r in kb.all_rules:
        c = out["knowledge_base"]["by_category"].setdefault(r.get("category"), {"verified": 0, "total": 0})
        c["total"] += 1
        c["verified"] += 1 if r.get("verified") else 0
    path = ROOT / "config" / "agents.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}: {len(out['agents'])} agents, {len(WORKFLOWS)} workflows, "
          f"{len(kb.rules)}/{len(kb.all_rules)} rules verified")


if __name__ == "__main__":
    main()
