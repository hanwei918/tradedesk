"""The agent / workflow / knowledge-base configuration as one JSON document.

Served live at /api/agents (the 智能体配置 page) and written to config/agents.json by
tools/export_config.py, so the page and the exported file can never disagree.
"""

from pathlib import Path

from .listing_catalog import LANGUAGES, LISTING_PLATFORMS
from .kb import PLATFORM_NAMES
from .llm import ATTEMPTS, CLAUDE_TIMEOUT, TIMEOUT
from .workflows import MAX_ROUNDS, MODEL_CALLS, ROLES

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"

AGENTS = [
    {"id": "analyst", "prompt": "understand_inquiry", "task_zh": "读询盘，抽取买家画像、需求、质量信号、与工厂资料的冲突；每条带询盘原文出处",
     "interaction_zh": "收到新询盘时自动触发；结果显示在“询盘分析”面板",
     "input_zh": "询盘原文 + 工厂与产品资料卡", "output_zh": "买家画像、需求、质量信号、和资料卡对不上的地方（每条带询盘原文）",
     "guard_zh": "引用的原文在询盘里找不到 → 代码丢弃这一条"},
    {"id": "sales", "prompt": "reply_inquiry", "task_zh": "用买家语言写阿里国际站 RFQ 回复 + 给采购/生产的中文内部备忘",
     "interaction_zh": "多轮：业务员用中文提修改意见，在上一版基础上改",
     "input_zh": "询盘原文 + 询盘分析 + 资料卡 + 业务员意图 + 阿里国际站规则摘要（第 2 轮再加上一版和修改意见）",
     "output_zh": "买家语言的回复 + 中文内部备忘 + 派给采购 / 生产 / 美工的任务",
     "guard_zh": "回复必须过规则校验和合规审核；任务的岗位和询盘原文由代码核对"},
    {"id": "ops_amazon", "prompt": "listing_amazon", "task_zh": "中文产品资料 → Amazon 美国站英文 Listing",
     "interaction_zh": "多轮：运营用中文提修改意见",
     "input_zh": "中文产品资料卡 + Amazon 美国站规则摘要", "output_zh": "标题、五点描述、商品描述、后台搜索词",
     "guard_zh": "生成后必须过规则校验和合规审核"},
    {"id": "ops_tiktok", "prompt": "listing_tiktok", "task_zh": "中文产品资料 → TikTok Shop 墨西哥西语种草脚本",
     "interaction_zh": "多轮：运营用中文提修改意见",
     "input_zh": "中文产品资料卡 + TikTok 墨西哥规则摘要", "output_zh": "开场 3 秒、分镜脚本、发布文案、话题",
     "guard_zh": "生成后必须过规则校验和合规审核"},
    {"id": "image_reviewer", "prompt": "vision_review", "task_zh": "看主图，按“模型判断”类主图规则（文字宣称、徽章、道具、是否实拍、只出现一次）审核；必须写出看到了什么",
     "interaction_zh": "在商品看板上传或选择主图后触发；像素指标由代码先测量",
     "input_zh": "主图 + 主图规则 + 代码测好的像素指标", "output_zh": "看到了什么 + 违反哪条规则",
     "guard_zh": "规则编号不在白名单、没写看到了什么 → 代码丢弃"},
    {"id": "compliance", "prompt": "compliance_review", "task_zh": "按知识库中“模型判断”类规则审核文本；必须给出规则编号和原文片段，否则被代码丢弃",
     "interaction_zh": "每次生成后自动触发",
     "input_zh": "适用规则的原文和判断问题 + 资料卡 + 待审文本（按字段）", "output_zh": "问题清单：规则编号 + 原文片段 + 问题 + 修改建议",
     "guard_zh": "规则编号没给过、原文片段在待审文本里找不到 → 代码丢弃"},
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
    {"id": "E", "name_zh": "询盘 → 上架交接", "trigger_zh": "回完询盘后，给在线上卖货的买家附上架文案",
     "steps": [
         {"step_zh": "回复询盘（工作流 A）", "agent": "analyst / sales / compliance"},
         {"step_zh": "用同一张资料卡生成 Listing（工作流 B）", "agent": "ops_amazon / compliance"},
         {"step_zh": "交接核对（代码）", "agent": None,
          "detail_zh": "逐项比对回复和 Listing：没有的认证有没有被写成有、没检测的材料宣称、容量和电压是否和资料卡一致"},
     ]},
]


def orchestration():
    """Who calls whom and when everything stops. Every number comes from the code that enforces it."""
    c = MODEL_CALLS
    return {
        "summary_zh": "智能体之间不互相调用，也不互相回话：由代码按固定顺序调用每个智能体，跑完最后一步就停。",
        "stop_rules_zh": [
            "每一轮的步骤是固定的，跑完就停；没有“智能体自己决定再跑一次”的分支。",
            f"下一轮只在人提交修改意见时开始，最多 {MAX_ROUNDS} 轮；超过后代码拒绝再生成，请人直接改。",
            f"单次模型调用超时 {TIMEOUT} 秒（Claude 开思考时 {CLAUDE_TIMEOUT} 秒）；网络错误、限流、服务端 5xx 最多尝试 {ATTEMPTS} 次。"
            "模型回答不是合法 JSON 不重试：理解或生成那一步失败，整条请求报错停下；审核那一步失败，保留代码规则的结果并标为需要人工确认。",
            "每个智能体的输出先过代码护栏：没有出处、规则编号不在白名单、引用的原文对不上，这一条就被丢弃，不回传给模型重写，所以不会来回拉扯。",
            "风险等级由代码算：模型审核没跑成功时，结果不会显示绿色。",
        ],
        "calls_per_round_zh": {
            "A": f"第 1 轮最多 {c['inquiry_first']} 次模型调用（理解、生成、审核）；之后每轮最多 {c['inquiry_revision']} 次（理解复用第 1 轮）",
            "B": f"每个选中的平台每轮最多 {c['listing_per_platform']} 次（生成、审核；平台没有需要模型判断的规则时不审核）",
            "C": f"批量生成 = 每个产品跑一遍 B；每张主图看图审核 {c['image']} 次",
            "D": f"每条询盘 {c['triage']} 次，和 A 的“理解询盘”共用同一份缓存",
            "E": "= A + B；交接核对是代码，不调用模型",
        },
        "max_rounds": MAX_ROUNDS, "timeout_seconds": {"default": TIMEOUT, "claude": CLAUDE_TIMEOUT},
        "attempts": ATTEMPTS, "model_calls": MODEL_CALLS,
    }


def build(kb, llm):
    out = {
        "app": "TradeDesk 出海工作台",
        "model": {"endpoint": llm.endpoint, "model": llm.model, "temperature": 0, "seed": 42,
                  "response_format": "json_object", "modes": ["live", "record", "replay"]},
        "agents": [dict(a, role_zh=ROLES[a["id"]],
                        prompt_file=f"prompts/{a['prompt']}.md",
                        prompt_text=(PROMPTS / f"{a['prompt']}.md").read_text(encoding="utf-8"))
                   for a in AGENTS],
        "listing_agents": [{"platform": pid, "platform_name": c["name"], "role": c["role"], "role_zh": ROLES[c["role"]],
                            "default_language": c["default_language"],
                            "rules": [r["id"] for r in kb.rules_for(pid)],
                            "prompt_file": f"prompts/{c['prompt']}.md",
                            "prompt_text": (PROMPTS / f"{c['prompt']}.md").read_text(encoding="utf-8")}
                           for pid, c in LISTING_PLATFORMS.items()],
        "listing_languages": {k: v["name"] for k, v in LANGUAGES.items()},
        "workflows": WORKFLOWS,
        "orchestration": orchestration(),
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
    return out
