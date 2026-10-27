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
from .kb import PLATFORM_NAMES
from .llm import LLMError

TEXT_KINDS = ["regex", "length", "llm"]

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "prompts"
LOG_PATH = ROOT / "logs" / "calls.jsonl"

MARKET_BY_LANGUAGE = {"es": "MX", "en": "US"}
LANGUAGE_NAMES = {"en": "English", "es": "Spanish (Mexico, formal usted)", "pt": "Portuguese", "fr": "French"}

ROLES = {
    "analyst": "询盘分析员",
    "sales": "外贸业务员",
    "ops_amazon": "Amazon 运营",
    "ops_tiktok": "TikTok 内容运营",
    "compliance": "合规审核员",
    "image_reviewer": "主图审核员",
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

    def review(self, trace, run_id, workflow, platform, fields, product, trigger, market=None):
        """Rule checks + model review with the citation guard."""
        findings = checks.run_rule_checks(fields, product, self.kb, platform, market)
        llm_rules = self.kb.rules_for(platform, kinds=["llm"], market=market)
        dropped, skipped = [], None
        if llm_rules:
            rules_for_model = [{"rule_id": r["id"], "title_zh": r.get("title_zh"),
                                "excerpt": r.get("excerpt"), "question_zh": r["check"].get("question_zh")}
                               for r in llm_rules]
            user = (f"## 平台\n{PLATFORM_NAMES.get(platform, platform)}\n\n"
                    f"## 规则\n{dumps(rules_for_model)}\n\n"
                    f"## 工厂与产品资料（只用来核对事实，不是待审文本）\n{dumps({'factory': self.kb.factory, 'product': product})}\n\n"
                    f"## 待审文本（按字段）\n{dumps(fields)}")
            try:
                data = self._step(trace, run_id, workflow, f"合规审核 · {platform}", "compliance",
                                  prompt("compliance_review"), user, trigger)
                kept, dropped = checks.guard_model_findings(data.get("findings"), llm_rules, fields)
                findings = checks.dedupe(findings + kept)
            except LLMError as exc:
                # Rule checks still stand; the result can never be green without the review.
                skipped = {"reason_zh": str(exc), "rules": [r["id"] for r in llm_rules]}
        risk = checks.risk_level(findings)
        if skipped and risk == "green":
            risk = "amber"
        self._log({"run_id": run_id, "ts": time.strftime("%Y-%m-%d %H:%M:%S"), "workflow": workflow,
                   "step": f"校验结果 · {platform}", "trigger": trigger,
                   "findings": findings, "dropped": dropped, "review_skipped": skipped, "risk": risk})
        return {"findings": findings, "dropped": dropped, "risk": risk, "review_skipped": skipped,
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
        trigger = "业务员修改意见" if previous else "收到新询盘"

        facts = {"factory": self.kb.factory, "product": product}
        understanding = payload.get("understanding")
        if not understanding:
            understanding = self._understand(trace, run_id, "A 询盘回复", inquiry_text, product, trigger)

        language = payload.get("language") or (understanding.get("buyer") or {}).get("language") or "en"
        language = language if language in LANGUAGE_NAMES else "en"
        market = MARKET_BY_LANGUAGE.get(language, "US")
        parts = [f"## 询盘原文\n{inquiry_text}", f"## 询盘分析\n{dumps(understanding)}",
                 f"## 工厂与产品资料\n{dumps(facts)}", f"## 业务员意图\n{intent or '（无）'}",
                 f"## 平台与沟通规则（知识库）\n{dumps(self._guidance('alibaba_rfq', market))}"]
        if previous:
            parts += [f"## 上一版回复\n{previous.get('reply', '')}", f"## 修改意见\n{instruction}"]
        draft = self._step(trace, run_id, "A 询盘回复", f"生成回复 · 第 {rnd} 轮", "sales",
                           prompt("reply_inquiry", language_name=LANGUAGE_NAMES[language]),
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

    def _understand(self, trace, run_id, workflow, inquiry_text, product, trigger):
        """Shared by replies and inbox triage, so both reuse the same cached answer."""
        facts = {"factory": self.kb.factory, "product": product}
        user = f"## 询盘原文\n{inquiry_text}\n\n## 工厂与产品资料\n{dumps(facts)}"
        data = self._step(trace, run_id, workflow, "理解询盘", "analyst", prompt("understand_inquiry"), user, trigger)
        return self._guard_understanding(data, inquiry_text)

    def triage(self, payload):
        """Understand every inquiry in the inbox (or the given ids) and score its priority."""
        ids = payload.get("inquiry_ids") or [q["id"] for q in self.kb.inquiries]
        out = []
        for q in self.kb.inquiries:
            if q["id"] not in ids:
                continue
            run_id = uuid.uuid4().hex[:8]
            trace = []
            product = self.kb.product(q["product_id"])
            u = self._understand(trace, run_id, "收件箱整理", q["text"].strip(), product, "整理收件箱")
            prio = priority(u, product)
            self.inbox.set_triage(q["id"], u, prio)
            out.append({"inquiry_id": q["id"], "priority": prio, "trace": trace})
        return {"triaged": out}

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

    # ------------------------------------------------------------ workflow B
    def listing(self, payload):
        run_id = uuid.uuid4().hex[:8]
        trace = []
        product = self.kb.product(payload["product_id"])
        platforms = payload.get("platforms") or ["amazon_us", "tiktok_mx"]
        previous = payload.get("previous") or {}
        instruction = (payload.get("instruction_zh") or "").strip()
        rnd = int(payload.get("round") or 1)
        trigger = "运营修改意见" if previous else "新品上架"
        out = {"run_id": run_id, "round": rnd, "platforms": {}, "trace": trace}
        for platform in platforms:
            name = {"amazon_us": "listing_amazon", "tiktok_mx": "listing_tiktok"}[platform]
            role = {"amazon_us": "ops_amazon", "tiktok_mx": "ops_tiktok"}[platform]
            parts = [f"## 产品资料（中文）\n{dumps(product)}",
                     f"## 平台规则（知识库）\n{dumps(self._guidance(platform))}"]
            prev = previous.get(platform)
            if prev:
                parts += [f"## 上一版\n{dumps(prev.get('content'))}", f"## 修改意见\n{instruction}"]
            content = self._step(trace, run_id, "B 多平台上架", f"生成 {PLATFORM_NAMES[platform]} · 第 {rnd} 轮",
                                 role, prompt(name), "\n\n".join(parts), trigger)
            fields = flatten(platform, content)
            review = self.review(trace, run_id, "B 多平台上架", platform, fields, product, trigger)
            diff = None
            if prev:
                old = flatten(platform, prev.get("content") or {})
                diff = {k: word_diff(old.get(k, ""), v) for k, v in fields.items()}
            out["platforms"][platform] = {"content": content, "fields": fields, "diff": diff, **review}
            self.board.record(product["id"], platform, dict(out["platforms"][platform], round=rnd), run_id)
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
        risk = checks.risk_level(findings)
        if (skipped or pixel_skipped) and risk == "green":
            risk = "amber"
        result = {"run_id": run_id, "metrics": metrics, "findings": findings, "dropped": dropped, "risk": risk,
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
        review = self.review(trace, run_id, "已有文案检查", platform, fields, product, "粘贴已有文案")
        return {"run_id": run_id, "fields": fields, "trace": trace, **review}


def flatten(platform, content):
    content = content or {}
    if platform == "amazon_us":
        fields = {"title": content.get("title", "")}
        for i, b in enumerate(content.get("bullets") or []):
            fields[f"bullets[{i + 1}]"] = b
        fields["description"] = content.get("description", "")
        fields["search_terms"] = content.get("search_terms", "")
        return fields
    if platform == "tiktok_mx":
        fields = {"hook": content.get("hook", "")}
        for i, s in enumerate(content.get("script") or []):
            fields[f"script[{i + 1}]"] = s.get("line", "") if isinstance(s, dict) else str(s)
        fields["caption"] = content.get("caption", "")
        fields["hashtags"] = " ".join(content.get("hashtags") or [])
        return fields
    return {k: v for k, v in content.items() if isinstance(v, str)}
