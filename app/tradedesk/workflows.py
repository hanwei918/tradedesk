"""The two workflows: inquiry reply (A) and multi-platform listing (B).

Each run goes understand -> generate -> check -> feedback, and every step is
written to logs/calls.jsonl so one complete call can be shown end to end.
"""

import difflib
import json
import re
import time
import uuid
from pathlib import Path

import hashlib

from . import checks, images
from .board import Board
from .inbox import Inbox, guard_tasks, priority
from .kb import PLATFORM_MARKET, PLATFORM_NAMES
from .listing_catalog import LANGUAGES, LISTING_PLATFORMS
from .llm import LLMError
from .pauses import split_paused

TEXT_KINDS = ["regex", "length", "llm"]

# Stop conditions. Agents never call each other: the code below calls each one in a fixed order and
# stops after the last step. A new round starts only when a person sends a revision instruction, and
# never past MAX_ROUNDS. MODEL_CALLS is the most one round can cost (the review is skipped when no rule needs
# the model); a test counts the real calls against it.
MAX_ROUNDS = 5
MODEL_CALLS = {"inquiry_first": 3,       # understand, write, review
               "inquiry_revision": 2,    # write, review (the understanding is reused)
               "listing_per_platform": 2,  # write, review
               "triage": 1, "image": 1,
               "follow_up": 3}           # understand (shared cache, skipped when the inbox has it), write, review


def check_round(rnd):
    if rnd < 1:
        raise ValueError("轮次从 1 开始")
    if rnd > MAX_ROUNDS:
        raise ValueError(f"最多改 {MAX_ROUNDS} 轮，到这里系统不再自动重写：请直接手改，"
                         "或换一条修改意见从第 1 轮重新生成")

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "prompts"
LOG_PATH = ROOT / "logs" / "calls.jsonl"

# Only for pasted inquiries: a sample inquiry names its own market (an English inquiry may come from Nigeria).
MARKET_BY_LANGUAGE = {"es": "MX", "en": "US", "de": "EU", "ja": "JP", "ru": "EAEU"}
LANGUAGE_NAMES = {"en": "English", "es": "Spanish (Mexico, formal usted)", "pt": "Portuguese", "fr": "French",
                  "de": "German (formal Sie)", "ja": "Japanese (business keigo)", "ru": "Russian (formal Вы)"}

ROLES = {
    "analyst": "询盘分析员",
    "sales": "外贸业务员",
    "ops_amazon": "Amazon 运营",
    "ops_tiktok": "TikTok 内容运营",
    "ops_listing": "平台运营",
    "ops_ebay": "eBay 运营",
    "ops_shopify": "Shopify 运营",
    "ops_etsy": "Etsy 运营",
    "ops_walmart": "Walmart 运营",
    "ops_mercadolibre": "Mercado Libre 运营",
    "ops_aliexpress": "AliExpress 运营",
    "compliance": "合规审核员",
    "image_reviewer": "主图审核员",
    "generic": "通用 AI 助手（对照组）",
}


def prompt(name, **fmt):
    text = (PROMPTS / f"{name}.md").read_text(encoding="utf-8")
    for k, v in fmt.items():
        text = text.replace("{" + k + "}", v)
    return text


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1)


def word_diff(old, new):
    tok = lambda s: re.findall(r"\s+|\w+|[^\w\s]", s or "")
    a, b = tok(old), tok(new)
    ops = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if tag == "equal":
            ops.append({"op": "equal", "text": "".join(a[i1:i2])})
        else:
            if i2 > i1:
                ops.append({"op": "delete", "text": "".join(a[i1:i2])})
            if j2 > j1:
                ops.append({"op": "insert", "text": "".join(b[j1:j2])})
    return ops


class Runner:
    def __init__(self, llm, kb, log_path=LOG_PATH, board=None, inbox=None):
        self.llm = llm
        self.kb = kb
        self.log_path = Path(log_path)
        self.board = board or Board()
        self.inbox = inbox or Inbox(self.board.dir)

    # ------------------------------------------------------------ helpers
    def _log(self, entry):
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def _step(self, trace, run_id, workflow, step, role, system, user, trigger, image=None):
        data, meta = self.llm.chat_json(system, user, image)
        record = {"run_id": run_id, "ts": time.strftime("%Y-%m-%d %H:%M:%S"), "workflow": workflow,
                  "step": step, "role": ROLES.get(role, role), "trigger": trigger,
                  "input_chars": len(user), "input_preview": user[:600], "output": data, "meta": meta}
        self._log(record)
        trace.append({"step": step, "role": ROLES.get(role, role), "meta": meta})
        return data

    def _guidance(self, platform, market=None):
        rules = self.kb.rules_for(platform, kinds=TEXT_KINDS, market=market)
        return [{"id": r["id"], "rule_zh": r.get("summary_zh")} for r in rules]

    def _facts(self, product, market=None):
        """Factory and product card, plus what a newer market needs from this product (none for the US or Mexico)."""
        facts = {"factory": self.kb.factory_for(product), "product": product}
        profile = self.kb.market_profile(market, product["id"]) if market else None
        if profile:
            facts["market"] = profile
        return facts

    def review(self, trace, run_id, workflow, platform, fields, product, trigger, market=None, rules_only=False):
        """Rule checks + model review with the citation guard (rules_only: code rules only, no model call)."""
        profile = self.kb.market_profile(market, product["id"]) if market else None
        if profile:  # certifications this market needs and the factory lacks count as "not held" for the code checks
            product = dict(product, certifications_not_held=product.get("certifications_not_held", []) + profile["certifications_not_held"])
        findings = checks.run_rule_checks(fields, product, self.kb, platform, market)
        llm_rules = self.kb.rules_for(platform, kinds=["llm"], market=market)
        dropped, skipped = [], None
        if llm_rules and rules_only:
            skipped = {"reason_zh": "只跑了代码规则，模型审核没有运行", "rules": [r["id"] for r in llm_rules]}
        elif llm_rules:
            rules_for_model = [{"rule_id": r["id"], "title_zh": r.get("title_zh"),
                                "excerpt": r.get("excerpt"), "question_zh": r["check"].get("question_zh")}
                               for r in llm_rules]
            user = (f"## 平台\n{PLATFORM_NAMES.get(platform, platform)}\n\n"
                    f"## 规则\n{dumps(rules_for_model)}\n\n"
                    f"## 工厂与产品资料（只用来核对事实，不是待审文本）\n{dumps(self._facts(product, market) if profile else {'factory': self.kb.factory_for(product), 'product': product})}\n\n"
                    f"## 待审文本（按字段）\n{dumps(fields)}")
            try:
                data = self._step(trace, run_id, workflow, f"合规审核 · {platform}", "compliance",
                                  prompt("compliance_review"), user, trigger)
                kept, dropped = checks.guard_model_findings(data.get("findings"), llm_rules, fields)
                findings = checks.dedupe(findings + kept)
            except LLMError as exc:
                # Rule checks still stand; the result can never be green without the review.
                skipped = {"reason_zh": str(exc), "rules": [r["id"] for r in llm_rules]}
        findings, paused_hits = split_paused(findings, self.kb.paused)
        risk = checks.risk_level(findings)
        if skipped and risk == "green":
            risk = "amber"
        self._log({"run_id": run_id, "ts": time.strftime("%Y-%m-%d %H:%M:%S"), "workflow": workflow,
                   "step": f"校验结果 · {platform}", "trigger": trigger, "findings": findings, "dropped": dropped,
                   "paused_hits": paused_hits, "review_skipped": skipped, "risk": risk})
        return {"findings": findings, "dropped": dropped, "paused_hits": paused_hits, "risk": risk, "review_skipped": skipped,
                "rules_checked": [r["id"] for r in self.kb.rules_for(platform, kinds=TEXT_KINDS, market=market)]}

    # ------------------------------------------------------------ workflow A
    def inquiry(self, payload):
        run_id = uuid.uuid4().hex[:8]
        trace = []
        product = self.kb.product(payload["product_id"])
        inquiry_text = payload["inquiry_text"].strip()
        intent = (payload.get("intent_zh") or "").strip()
        previous = payload.get("previous")
        instruction = (payload.get("instruction_zh") or "").strip()
        rnd = int(payload.get("round") or 1)
        check_round(rnd)
        trigger = "业务员修改意见" if previous else "收到新询盘"

        record = next((q for q in self.kb.inquiries if q["id"] == payload.get("inquiry_id")), {})
        market = payload.get("market") or record.get("market")
        understanding = payload.get("understanding")
        if not understanding:
            understanding = self._understand(trace, run_id, "A 询盘回复", inquiry_text, product, trigger, market)

        language = payload.get("language") or (understanding.get("buyer") or {}).get("language") or "en"
        language = language if language in LANGUAGE_NAMES else "en"
        market = market or MARKET_BY_LANGUAGE.get(language, "US")
        facts = self._facts(product, market)
        parts = [f"## 询盘原文\n{inquiry_text}", f"## 询盘分析\n{dumps(understanding)}",
                 f"## 工厂与产品资料\n{dumps(facts)}", f"## 业务员意图\n{intent or '（无）'}",
                 f"## 平台与沟通规则（知识库）\n{dumps(self._guidance('alibaba_rfq', market))}"]
        if previous:
            parts += [f"## 上一版回复\n{previous.get('reply', '')}", f"## 修改意见\n{instruction}"]
        draft = self._step(trace, run_id, "A 询盘回复", f"生成回复 · 第 {rnd} 轮", "sales",
                           prompt("reply_inquiry", language_name=LANGUAGE_NAMES[language],
                                  factory_kind=self.kb.factory_for(product).get("category_zh", "小家电")),
                           "\n\n".join(parts), trigger)
        reply = draft.get("reply", "")
        review = self.review(trace, run_id, "A 询盘回复", "alibaba_rfq", {"reply": reply}, product, trigger, market)
        tasks, tasks_dropped = guard_tasks(draft.get("tasks"), inquiry_text, checks.norm)
        inquiry_id = payload.get("inquiry_id")
        if inquiry_id:
            label = next((q.get("label_zh", inquiry_id) for q in self.kb.inquiries if q["id"] == inquiry_id), inquiry_id)
            if rnd == 1 or tasks:
                self.inbox.replace_tasks(inquiry_id, label, tasks, run_id)
            self.inbox.set_replied(inquiry_id, run_id, rnd, review["risk"])
        return {
            "tasks": tasks, "tasks_dropped": tasks_dropped,
            "run_id": run_id, "round": rnd, "language": language, "market": market,
            "understanding": understanding,
            "reply": reply, "internal_brief_zh": draft.get("internal_brief_zh", ""),
            "notes_zh": draft.get("notes_zh", ""),
            "diff": word_diff(previous.get("reply", ""), reply) if previous else None,
            "trace": trace, **review,
        }

    # ------------------------------------------------------------ follow-up (from the daily digest)
    def follow_up(self, payload):
        """A short nudge to a buyer who has not answered: same facts, same checks as the first reply."""
        run_id = uuid.uuid4().hex[:8]
        trace = []
        record = next((q for q in self.kb.inquiries if q["id"] == payload.get("inquiry_id")), None)
        if not record:
            raise ValueError("找不到这条询盘")
        sent = (payload.get("sent") or "").strip()
        if not sent:
            raise ValueError("这条询盘还没有记录过发出的回复，没有可跟进的内容")
        product = self.kb.product(payload.get("product_id") or record["product_id"])
        market = record.get("market")
        trigger = "每日摘要 · 跟进"
        understanding = payload.get("understanding") or self._understand(
            trace, run_id, "跟进", record["text"].strip(), product, trigger, market)
        language = (understanding.get("buyer") or {}).get("language") or record.get("language") or "en"
        language = language if language in LANGUAGE_NAMES else "en"
        market = market or MARKET_BY_LANGUAGE.get(language, "US")
        parts = [f"## 询盘原文\n{record['text'].strip()}", f"## 询盘分析\n{dumps(understanding)}",
                 f"## 工厂与产品资料\n{dumps(self._facts(product, market))}",
                 f"## 上次发出的回复（{int(payload.get('days') or 0)} 天前）\n{sent}",
                 f"## 业务员补充\n{(payload.get('instruction_zh') or '').strip() or '（无）'}",
                 f"## 平台与沟通规则（知识库）\n{dumps(self._guidance('alibaba_rfq', market))}"]
        draft = self._step(trace, run_id, "跟进", "生成跟进", "sales",
                           prompt("follow_up", language_name=LANGUAGE_NAMES[language],
                                  factory_kind=self.kb.factory_for(product).get("category_zh", "小家电")),
                           "\n\n".join(parts), trigger)
        reply = draft.get("reply", "")
        review = self.review(trace, run_id, "跟进", "alibaba_rfq", {"reply": reply}, product, trigger, market)
        return {"run_id": run_id, "inquiry_id": record["id"], "language": language, "market": market,
                "reply": reply, "notes_zh": draft.get("notes_zh", ""), "trace": trace, **review}

    def _understand(self, trace, run_id, workflow, inquiry_text, product, trigger, market=None):
        """Shared by replies and inbox triage, so both reuse the same cached answer."""
        facts = self._facts(product, market)
        user = f"## 询盘原文\n{inquiry_text}\n\n## 工厂与产品资料\n{dumps(facts)}"
        data = self._step(trace, run_id, workflow, "理解询盘", "analyst", prompt("understand_inquiry"), user, trigger)
        return self._guard_understanding(data, inquiry_text)

    def triage(self, payload):
        """Understand every inquiry in the inbox (or the given ids) and score its priority."""
        ids = payload.get("inquiry_ids") or [q["id"] for q in self.kb.inquiries]
        out, failed = [], []
        for q in self.kb.inquiries:
            if q["id"] not in ids:
                continue
            run_id = uuid.uuid4().hex[:8]
            trace = []
            product = self.kb.product(q["product_id"])
            try:
                u = self._understand(trace, run_id, "收件箱整理", q["text"].strip(), product, "整理收件箱", q.get("market"))
            except LLMError as exc:  # one inquiry without an answer (e.g. imported, in replay mode) must not stop the rest
                failed.append({"inquiry_id": q["id"], "reason_zh": str(exc)})
                continue
            prio = priority(u, product)
            self.inbox.set_triage(q["id"], u, prio)
            out.append({"inquiry_id": q["id"], "priority": prio, "trace": trace})
        if failed and not out:
            raise LLMError(failed[0]["reason_zh"])
        return {"triaged": out, "failed": failed}

    @staticmethod
    def _guard_understanding(data, inquiry_text):
        """Drop any analysis item whose quote is not in the inquiry."""
        text = checks.norm(inquiry_text)
        dropped = 0
        for key in ("requests", "signals", "conflicts"):
            items = data.get(key) or []
            keep = [i for i in items if isinstance(i, dict) and len((i.get("quote") or "").strip()) >= 2
                    and checks.norm(i["quote"]) in text]
            dropped += len(items) - len(keep)
            data[key] = keep
        data["dropped_without_quote"] = dropped
        return data

    # ------------------------------------------------------------ comparison arms
    BASELINE_ASK = "我是做小家电的外贸业务员，帮我回复这条阿里巴巴国际站的询盘，用买家的语言，尽量拿下订单：\n\n"

    def baseline(self, payload):
        """A general-purpose AI reply to the same inquiry, measured by exactly the same checks.

        variant "plain":      what a salesperson does today — paste the inquiry into a chat AI.
        variant "with_facts": the same, plus the factory card and the salesperson's intent.
        """
        run_id = uuid.uuid4().hex[:8]
        trace = []
        q = next(x for x in self.kb.inquiries if x["id"] == payload["inquiry_id"])
        variant = payload["variant"]
        product = self.kb.product(q["product_id"])
        market = MARKET_BY_LANGUAGE.get(q.get("language"), "US")
        user = self.BASELINE_ASK + q["text"].strip()
        if variant == "with_facts":
            user += (f"\n\n我们工厂和产品的资料如下，请按资料回复：\n{dumps({'factory': self.kb.factory_for(product), 'product': product})}"
                     f"\n\n我的意图：{q.get('intent_zh', '')}")
        elif variant != "plain":
            raise ValueError("variant 只能是 plain 或 with_facts")
        data = self._step(trace, run_id, f"对照组 · {variant}", "生成回复", "generic",
                          prompt("baseline_assistant"), user, "对照实验")
        reply = data.get("reply", "")
        review = self.review(trace, run_id, f"对照组 · {variant}", "alibaba_rfq", {"reply": reply},
                             product, "对照实验", market)
        return {"run_id": run_id, "variant": variant, "inquiry_id": q["id"], "reply": reply, "trace": trace, **review}

    # ------------------------------------------------------------ workflow B
    def listing(self, payload):
        run_id = uuid.uuid4().hex[:8]
        trace = []
        product = self.kb.product(payload["product_id"])
        platforms = payload.get("platforms", ["amazon_us", "tiktok_mx"])
        if not isinstance(platforms, list) or not platforms:
            raise ValueError("至少选择一个上架平台")
        if any(not isinstance(p, str) for p in platforms):
            raise ValueError("上架平台格式不正确")
        platforms = list(dict.fromkeys(platforms))
        unknown = [p for p in platforms if p not in LISTING_PLATFORMS]
        if unknown:
            raise ValueError(f"不支持的上架平台：{unknown[0]}")
        languages = payload.get("languages") or {}
        if not isinstance(languages, dict):
            raise ValueError("平台语言配置格式不正确")
        previous = payload.get("previous") or {}
        instruction = (payload.get("instruction_zh") or "").strip()
        rnd = int(payload.get("round") or 1)
        check_round(rnd)
        trigger = "运营修改意见" if previous else "新品上架"
        out = {"run_id": run_id, "round": rnd, "platforms": {}, "trace": trace,
               "board_channels": []}
        for platform in platforms:
            config = LISTING_PLATFORMS[platform]
            language = languages.get(platform) or config["default_language"]
            if not isinstance(language, str) or language not in LANGUAGES:
                raise ValueError(f"{config['name']}：不支持的输出语言")
            language_name = LANGUAGES[language]["prompt"]
            name, role = config["prompt"], config["role"]
            parts = [f"## 产品资料（中文）\n{dumps(product)}",
                     f"## 平台规则（知识库）\n{dumps(self._guidance(platform))}"]
            prev = previous.get(platform)
            if prev:
                parts += [f"## 上一版\n{dumps(prev.get('content'))}", f"## 修改意见\n{instruction}"]
            platform_name = config["name"]
            system = prompt(name, platform=platform_name)
            if language != config["default_language"]:
                system += f"\nOutput language: {language_name}."
            content = self._step(trace, run_id, "B 多平台上架", f"生成 {platform_name} · 第 {rnd} 轮",
                                 role, system,
                                 "\n\n".join(parts), trigger)
            fields = flatten(platform, content)
            review = self.review(trace, run_id, "B 多平台上架", platform, fields, product, trigger,
                                 PLATFORM_MARKET.get(platform))
            diff = None
            if prev:
                old = flatten(platform, prev.get("content") or {})
                diff = {k: word_diff(old.get(k, ""), v) for k, v in fields.items()}
            out["platforms"][platform] = {"content": content, "fields": fields, "diff": diff,
                                          "language": language, "language_name": LANGUAGES[language]["name"],
                                          "platform_name": platform_name, **review}
            if platform in ("amazon_us", "tiktok_mx"):
                self.board.record(product["id"], platform, dict(out["platforms"][platform], round=rnd), run_id)
                out["board_channels"].append(platform)
        return out

    # ------------------------------------------------------------ main image
    def image_check(self, payload):
        """Check one main image: pixel facts by code, then a vision review with the rule-id guard."""
        run_id = uuid.uuid4().hex[:8]
        trace = []
        product = self.kb.product(payload["product_id"])
        media, raw, b64 = images.parse_data_url(payload["image"])
        trigger = "上传主图"
        rules = self.kb.rules_for("amazon_us", kinds=["image", "vision"])
        pixel_rules = [r for r in rules if r["check"]["kind"] == "image"]
        vision_rules = [r for r in rules if r["check"]["kind"] == "vision"]
        metrics = images.measure(raw)
        findings = images.pixel_findings(metrics, pixel_rules) if metrics else []
        pixel_skipped = None if metrics else {"reason_zh": "本机没有安装 Pillow，像素检查没有运行",
                                              "rules": [r["id"] for r in pixel_rules]}
        self._log({"run_id": run_id, "ts": time.strftime("%Y-%m-%d %H:%M:%S"), "workflow": "C 主图检查",
                   "step": "像素测量（代码）", "trigger": trigger, "product": product["id"],
                   "image_sha256": hashlib.sha256(raw).hexdigest()[:16], "metrics": metrics})
        dropped, skipped, description = [], None, ""
        rules_for_model = [{"rule_id": r["id"], "title_zh": r.get("title_zh"), "excerpt": r.get("excerpt"),
                            "question_zh": r["check"].get("question_zh")} for r in vision_rules]
        user = (f"## 规则\n{dumps(rules_for_model)}\n\n## 产品资料\n{dumps(product)}\n\n"
                f"## 代码已测量的像素指标（仅供参考）\n{dumps(metrics)}")
        try:
            data = self._step(trace, run_id, "C 主图检查", "看图审核", "image_reviewer",
                              prompt("vision_review"), user, trigger, image={"media_type": media, "data": b64})
            kept, dropped = images.guard_vision_findings(data.get("findings"), vision_rules)
            findings = checks.dedupe(findings + kept)
            description = data.get("description_zh", "")
        except LLMError as exc:
            skipped = {"reason_zh": str(exc), "rules": [r["id"] for r in vision_rules]}
        findings, paused_hits = split_paused(findings, self.kb.paused)
        risk = checks.risk_level(findings)
        if (skipped or pixel_skipped) and risk == "green":
            risk = "amber"
        result = {"run_id": run_id, "metrics": metrics, "findings": findings, "dropped": dropped, "risk": risk,
                  "paused_hits": paused_hits,
                  "review_skipped": skipped or pixel_skipped, "description_zh": description,
                  "rules_checked": [r["id"] for r in rules], "trace": trace, "image_name": payload.get("name", "")}
        self._log({"run_id": run_id, "ts": time.strftime("%Y-%m-%d %H:%M:%S"), "workflow": "C 主图检查",
                   "step": "校验结果 · 主图", "trigger": trigger, "findings": findings, "dropped": dropped,
                   "review_skipped": skipped or pixel_skipped, "risk": risk})
        self.board.save_image(product["id"], media, raw)
        self.board.record(product["id"], "image", result, run_id)
        return result

    # ------------------------------------------------------------ paste & check
    def check_text(self, payload):
        run_id = uuid.uuid4().hex[:8]
        trace = []
        product = self.kb.product(payload["product_id"])
        platform = payload["platform"]
        fields = payload.get("fields") or {"text": payload.get("text", "")}
        review = self.review(trace, run_id, "已有文案检查", platform, fields, product, "粘贴已有文案",
                             market=payload.get("market"), rules_only=bool(payload.get("rules_only")))
        return {"run_id": run_id, "fields": fields, "trace": trace, **review}


def flatten(platform, content):
    content = content or {}
    kind = LISTING_PLATFORMS.get(platform, {}).get("kind")
    if kind == "amazon":
        fields = {"title": content.get("title", "")}
        for i, b in enumerate(content.get("bullets") or []):
            fields[f"bullets[{i + 1}]"] = b
        fields["description"] = content.get("description", "")
        fields["search_terms"] = content.get("search_terms", "")
        return fields
    if kind == "tiktok":
        fields = {"hook": content.get("hook", "")}
        for i, s in enumerate(content.get("script") or []):
            fields[f"script[{i + 1}]"] = s.get("line", "") if isinstance(s, dict) else str(s)
        fields["caption"] = content.get("caption", "")
        fields["hashtags"] = " ".join(content.get("hashtags") or [])
        return fields
    fields = {}

    def collect(value, path):
        if isinstance(value, str):
            fields[path] = value
        elif isinstance(value, list):
            for i, item in enumerate(value, 1):
                collect(item, f"{path}[{i}]")
        elif isinstance(value, dict):
            for key, item in value.items():
                if key != "notes_zh":
                    collect(item, f"{path}.{key}" if path else key)

    collect(content, "")
    return fields
