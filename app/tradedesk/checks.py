"""Checks run on every generated text before a person sees it.

Two layers:
1. Deterministic checks (this module): product-fact checks against the product
   card, contract checks, and the regex/length rules in the knowledge base.
   Numbers and certifications are compared by code, never by the model.
2. Model review (see workflows.py): the model may only report a finding that
   names a rule id it was given AND quotes text that really appears in the
   draft. `guard_model_findings` enforces both; anything else is dropped and
   counted, never shown as a finding.

Every finding carries its source: a verified KB rule (excerpt + URL) or the
product card / factory profile field it was compared against. A check with no
source does not run.
"""

import re

NEGATION = re.compile(
    r"(?i)(\bnot\b|\bno\b|n't\b|\bcannot\b|\bwithout\b|\bunable\b|\byet to\b|\bsin\b|"
    r"aún no|todavía no|\bningun[ao]?\b|没有|未|不)")
# Talking about the process of getting a certification is an offer (amber), never a claim of having it.
OFFER = re.compile(
    r"(?i)(can (help|assist|arrange|apply)|apply(ing)? for|look(ing)? into|evaluat\w*|consider(ing)?|explor(e|ing)|"
    r"in process|to obtain|obtain(ing)?|get(ting)? (it |the \w+ )?certified|work with you|"
    r"posibilidad|evaluando|tramit\w*|gestion\w*|obtener|colabor(ar|amos)|en proceso|"
    r"评估|办理|可以(协助|配合))")
# Narrower negation for material claims: "without worries" must not cancel "PTFE-free".
NEG_CLAIM = re.compile(
    r"(?i)(\bnot\b|\bno\b|n't\b|\bcannot\b|\bunable\b|\byet to\b|aún no|todavía no|没有|未)")
# A mention is not a claim when the sentence is a question, a condition, a request or quotes the buyer.
NOT_A_CLAIM = re.compile(
    r"(?i)(\bif\b|\bwhether\b|\bunless\b|\?|¿|\bsi\b|confirm|mandatory|required|requirement|\bneeds?\b|"
    r"\bmust\b|necesita|requiere|indispensable|obligatori|request|\bask|pregunt|solicit|mencion|mentioned|"
    r"\btarget|objetivo|\bdebe[n]?\b|necesari|requisito|\bplan\b|proceso|tr[aá]mite|para su venta|"
    r"in order to|如果|是否|需要|要求|计划)")
# Words that turn a certification mention into an assertion of having it.
CLAIM_CUE = re.compile(
    r"(?i)(listed|certified|certification|certificate|approved|compliant|compl(y|ies)|\bhas\b|\bhave\b|"
    r"\bholds?\b|\bwith\b|cuenta[n]? con|contamos con|tiene[n]?\b|tenemos|certificad[oa]s?|certificaci[óo]n|"
    r"homologad[oa]|aprobad[oa]|cumple|通过|具备|持有|有)")
QUOTES_BUYER = re.compile(
    r"(?i)(target|your (price|budget)|objetivo|mencion|mentioned|you (asked|requested)|cannot|can't|unable|"
    r"no podemos|below our|por debajo)")
# Only "so / but" start a new clause: commas also separate list items ("no UL, ETL ni NOM").
CLAUSE_SPLIT = re.compile(r"\b(?:so|but|pero|así que)\b|但是|所以", re.I)


def clause_of(sent, start):
    """The clause around a match: negation in another clause ("…, so no problem") must not cancel a claim."""
    bounds = [0] + [m.end() for m in CLAUSE_SPLIT.finditer(sent)] + [len(sent)]
    for a, b in zip(bounds, bounds[1:]):
        if a <= start < b:
            return sent[a:b]
    return sent


HEADING = re.compile(r"[:：]\s*$")  # "Certification (UL / ETL):" is a label line, not a claim
VERB_CUE = re.compile(r"(?i)\b(is|are|was|has|have|holds?|listed|certified|approved|cuenta|cuentan|contamos|tiene|tienen|tenemos)\b|具备|持有|通过")


def is_heading(sent):
    """A colon-ended line, or a short line with no verb such as "Certification (ETL/UL)"."""
    words = re.findall(r"\w+", sent)
    return bool(HEADING.search(sent)) or (len(words) <= 6 and not VERB_CUE.search(sent) and not sent.rstrip().endswith((".", "!", "。")))
SENTENCE_SPLIT = re.compile(r"(?<=[!?。！？；;])\s*|(?<=\.)\s+|\n+")

CERT_PATTERNS = {
    "UL": r"\bUL(?:[- ]?(?i:listed|certified|certification|approved))?\b",
    "ETL": r"\bETL\b",
    "NOM": r"\bNOM\b",
    "FDA registration": r"\bFDA\b",
    "FCC SDoC test report": r"\bFCC\b",
}
MATERIAL_CLAIMS = [
    ("BPA", r"(?i)\bBPA[- ]?free\b|libre de BPA|\bsin BPA\b|不含\s*BPA|无\s*BPA"),
    ("PTFE", r"(?i)\bPTFE[- ]?free\b|\bsin PTFE\b|libre de PTFE|无\s*PTFE|不含\s*PTFE"),
    ("PFOA", r"(?i)\bPFOA[- ]?free\b|\bsin PFOA\b|libre de PFOA"),
]
PRICE = re.compile(r"(?i)(?:US\$|USD\s?|\$)\s?(\d{1,4}(?:\.\d{1,2})?)|(\d{1,4}(?:\.\d{1,2})?)\s?(?:USD|dólares)")
LEAD = re.compile(r"(?i)(\d{1,3})\s*(?:(?:-|–|to|a)\s*(\d{1,3})\s*)?(?:working\s+|business\s+|calendar\s+)?(?:days|días(?: hábiles)?|天)")
MOQ = re.compile(r"(?i)(?:MOQ|minimum order(?: quantity)?|pedido mínimo|cantidad mínima|起订量)[^0-9]{0,25}(\d{1,3}(?:[,\s]\d{3})+|\d+)")
OPEN_ACCOUNT = re.compile(
    r"(?i)(\d+\s*days? after (?:the )?(?:goods |cargo |shipment )?(?:delivery|arrival|arrives?|arrived)|after delivery|open account|\bO/A\b|net\s?\d{2}\b|"
    r"después de la entrega|tras la entrega|货到付款|到货后\s*\d+\s*天)")
OFF_PLATFORM = re.compile(
    r"(?i)([\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s-]{8,}\d|whats\s?app|wechat|微信)")
# Talking about terms for later ("discuss … for repeat orders") is not accepting them now.
LATER = re.compile(r"(?i)\b(discuss|consider|in the future|once we|later|repeat orders?)\b|más adelante|en el futuro|pedidos recurrentes|以后|今后")
FOB_AIR = re.compile(r"(?i)\bFOB\b[^.。\n]{0,40}(by air|air ?freight|air shipment|air cargo|vía aérea|aére[oa]|por avi[oó]n|空运)"
                     r"|(by air|air ?freight|air shipment|air cargo|vía aérea|por avi[oó]n|空运)[^.。\n]{0,40}\bFOB\b")


def norm(s):
    s = (s or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("–", "-").replace("—", "-").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip().lower()


def sentences(text):
    return [s for s in SENTENCE_SPLIT.split(text or "") if s.strip()]


def kb_source(rule):
    return {"type": "kb", "rule_id": rule["id"], "title_zh": rule.get("title_zh"),
            "excerpt": rule.get("excerpt"), "url": rule.get("url")}


def card_source(label_zh, path, value):
    return {"type": "product_card", "label_zh": label_zh, "path": path, "value": value}


def finding(check, severity, field, quote, problem_zh, suggestion_zh, source, by="rule", context=None):
    """`context` is the sentence the quote was found in, so the UI marks the right occurrence."""
    f = {"check": check, "severity": severity, "field": field, "quote": quote.strip(),
         "problem_zh": problem_zh, "suggestion_zh": suggestion_zh, "source": source, "by": by}
    if context and context.strip() != f["quote"]:
        f["context"] = context.strip()
    return f


# ---------------------------------------------------------------- fact checks

def check_certifications(fields, product):
    out = []
    not_held = product.get("certifications_not_held", [])
    for cert in not_held:
        pattern = CERT_PATTERNS.get(cert)
        if not pattern:
            continue
        for field, text in fields.items():
            for sent in sentences(text):
                m = re.search(pattern, sent)
                if not m or is_heading(sent):
                    continue
                offer = OFFER.search(sent)
                if NEGATION.search(clause_of(sent, m.start())) and not offer:
                    continue
                path = f"products[{product['id']}].certifications_not_held"
                src = card_source("产品资料：工厂未持有的认证", path, ", ".join(not_held))
                if offer:
                    out.append(finding("fact_cert", "amber", field, m.group(0),
                                       f"承诺办理 {cert}，工厂目前没有，需要内部确认周期和费用后再承诺",
                                       f"改成“目前没有 {cert}，可以评估办理，周期和费用确认后回复”", src, context=sent))
                elif NOT_A_CLAIM.search(sent) or not CLAIM_CUE.search(sent):
                    continue
                else:
                    out.append(finding("fact_cert", "red", field, m.group(0),
                                       f"文本写成具备 {cert}，但工厂没有这项认证",
                                       f"删除 {cert} 的说法，如实说明现有认证（{', '.join(product.get('certifications_held', []))}）", src, context=sent))
    return out


def check_material_claims(fields, product, kb):
    out = []
    tests = product.get("material_tests", {})
    coating = (product.get("specs") or {}).get("basket_coating", "")
    substantiation = kb.mapped_rule("claim_substantiation")
    for name, pattern in MATERIAL_CLAIMS:
        lacks_proof = name in tests or (name == "PTFE" and "PTFE" in coating)
        if not lacks_proof:
            continue
        for field, text in fields.items():
            for sent in sentences(text):
                m = re.search(pattern, sent)
                if not m:
                    continue
                rest = sent.replace(m.group(0), " ")
                if NEG_CLAIM.search(clause_of(sent, m.start()).replace(m.group(0), " ")) or NOT_A_CLAIM.search(rest) or len(re.sub(r"[\W\d_]+", "", rest)) < 3:
                    continue
                if name == "PTFE":
                    value = coating
                    problem = "文本宣称无 PTFE，但产品资料写明篮子是 PTFE 涂层"
                else:
                    value = tests.get(name)
                    problem = f"文本宣称 {m.group(0)}，但工厂没有对应检测报告，无法证明"
                src = card_source("产品资料：材料与检测", f"products[{product['id']}].material_tests", value)
                if re.search(r"(?i)declara|声明|statement", sent):
                    f = finding("fact_material", "amber", field, m.group(0),
                                f"引用了供应商的 {m.group(0)} 声明，但没有成品第三方报告，能否对外宣称需人工确认",
                                "写清是“材料供应商声明”，不要写成产品经过检测", src, context=sent)
                else:
                    f = finding("fact_material", "red", field, m.group(0), problem,
                                "删除该宣称；如买家需要，先送检取得报告再写", src, context=sent)
                if substantiation:
                    f["source_extra"] = kb_source(substantiation)
                out.append(f)
    return out


def check_numbers(fields, product, factory):
    out = []
    prices = [v for v in (product.get("fob_ningbo_usd") or {}).values()]
    floor = min(prices) if prices else None
    lead = factory.get("standard_lead_time_days")
    moq = product.get("moq_units")
    for field, text in fields.items():
        for sent in sentences(text):
            if floor is not None and not QUOTES_BUYER.search(sent) and not NEGATION.search(sent):
                for m in PRICE.finditer(sent):
                    value = float(m.group(1) or m.group(2))
                    if value < floor and value > 1:
                        out.append(finding(
                            "fact_price", "red", field, m.group(0),
                            f"报价 {value} 低于价目表最低价 {floor}（FOB 宁波）",
                            "按价目表阶梯价报价；低于底价需要老板审批",
                            card_source("产品资料：FOB 宁波阶梯价", f"products[{product['id']}].fob_ningbo_usd",
                                        product.get("fob_ningbo_usd"))))
            if lead and not NEGATION.search(sent):
                for m in LEAD.finditer(sent):
                    days = min(int(x) for x in m.groups() if x)
                    if days < lead and days >= 5:
                        out.append(finding(
                            "fact_lead", "amber", field, m.group(0),
                            f"承诺 {days} 天，短于工厂标准交期 {lead} 天",
                            "改成标准交期，或先和生产确认能否加急",
                            card_source("工厂资料：标准交期（天）", "factory.standard_lead_time_days", lead)))
            if moq:
                for m in MOQ.finditer(sent):
                    qty = int(re.sub(r"[,\s]", "", m.group(1)))
                    if qty < moq:
                        out.append(finding(
                            "fact_moq", "red", field, m.group(0),
                            f"写的起订量 {qty} 低于工厂 MOQ {moq}",
                            f"改成 MOQ {moq}，或注明小单加价",
                            card_source("产品资料：MOQ", f"products[{product['id']}].moq_units", moq)))
            m = OPEN_ACCOUNT.search(sent)
            if m and not NEGATION.search(sent):
                src = card_source("工厂资料：可接受的付款方式", "factory.payment_terms_accepted",
                                  factory.get("payment_terms_accepted"))
                if LATER.search(sent):  # "we'd be glad to discuss open account for repeat orders"
                    out.append(finding(
                        "fact_payment", "amber", field, m.group(0),
                        "提到以后可以谈货到付款/赊账，工厂目前只接受定金 + 见提单付尾款或即期信用证，需老板确认",
                        "确认老板是否同意以后谈赊账；不同意就删掉这句", src, context=sent))
                else:
                    out.append(finding(
                        "fact_payment", "red", field, m.group(0),
                        "接受了货到后付款，工厂只接受定金 + 见提单付尾款或即期信用证",
                        "改成 30% 定金、70% 见提单副本付款，或即期 L/C", src, context=sent))
    return out


# ------------------------------------------------------------ contract / platform

def check_contract(fields, kb):
    out = []
    rule = kb.mapped_rule("fob_sea_only")
    if not rule:
        return out
    for field, text in fields.items():
        for sent in sentences(text):
            m = FOB_AIR.search(sent)
            if m and "FCA" not in sent.upper():
                out.append(finding("contract_incoterm", "amber", field, m.group(0),
                                   "FOB 用在了空运上；按 Incoterms 2020，FOB 只适用于海运和内河运输",
                                   "空运改用 FCA（如 FCA Ningbo Airport），海运再用 FOB", kb_source(rule)))
    return out


def check_off_platform(fields, kb, platform):
    rule = kb.mapped_rule("off_platform_contact") if platform == "alibaba_rfq" else None
    if not rule:
        return []
    out = []
    for field, text in fields.items():
        for m in OFF_PLATFORM.finditer(text or ""):
            out.append(finding("platform_contact", "amber", field, m.group(0),
                               "回复里出现站外联系方式", "删除站外联系方式，在平台内沟通", kb_source(rule)))
    return out


def _fields_for(rule_field, fields):
    # Pasted free text ("text") is checked against every field rule.
    if rule_field in (None, "any", "all") or list(fields) == ["text"]:
        return fields
    return {k: v for k, v in fields.items() if k == rule_field or k.startswith(rule_field + "[")}


def check_kb_rules(fields, kb, platform, market=None):
    out = []
    for rule in kb.rules_for(platform, kinds=["regex", "length"], market=market):
        spec = rule["check"]
        targets = _fields_for(spec.get("field"), fields)
        if spec["kind"] == "length":
            for field, text in targets.items():
                if text and len(text) > int(spec["max"]):
                    out.append(finding("kb_length", "red", field, "",
                                       f"{field} 长度 {len(text)} 字符，超过上限 {spec['max']}",
                                       "精简到上限以内", kb_source(rule)))
        else:
            try:
                pattern = re.compile(spec["pattern"])
            except re.error:
                continue
            for field, text in targets.items():
                for m in pattern.finditer(text or ""):
                    out.append(finding("kb_regex", spec.get("severity", "red"), field, m.group(0),
                                       spec.get("message_zh") or rule.get("title_zh"),
                                       spec.get("suggestion_zh") or "删除或改写这一处", kb_source(rule)))
    return out


def run_rule_checks(fields, product, kb, platform, market=None):
    findings = []
    findings += check_certifications(fields, product)
    findings += check_material_claims(fields, product, kb)
    findings += check_numbers(fields, product, kb.factory)
    findings += check_contract(fields, kb)
    findings += check_off_platform(fields, kb, platform)
    findings += check_kb_rules(fields, kb, platform, market)
    return dedupe(findings)


# ------------------------------------------------------------- model guard

def guard_model_findings(raw, allowed_rules, fields):
    """Keep a model finding only if its rule id was offered and its quote is in the text."""
    kept, dropped = [], []
    allowed = {r["id"]: r for r in allowed_rules}
    normalized = {k: norm(v) for k, v in fields.items()}
    for item in raw or []:
        if not isinstance(item, dict):
            dropped.append({"reason_zh": "格式不对", "item": item})
            continue
        rule = allowed.get(item.get("rule_id"))
        quote = (item.get("quote") or "").strip()
        if not rule:
            dropped.append({"reason_zh": "引用了不存在或未提供的规则编号", "item": item})
            continue
        if len(quote) < 3:
            dropped.append({"reason_zh": "没有给出原文片段", "item": item})
            continue
        field = next((k for k, v in normalized.items() if norm(quote) in v), None)
        if field is None:
            dropped.append({"reason_zh": "引用的原文在待审文本里找不到", "item": item})
            continue
        severity = item.get("severity") if item.get("severity") in ("red", "amber") else "amber"
        if rule.get("category") == "culture":  # tone and greetings never block a reply
            severity = "amber"
        kept.append(finding("model_review", severity, field, quote,
                            item.get("problem_zh") or rule.get("title_zh"),
                            item.get("suggestion_zh") or "", kb_source(rule), by="model"))
    return kept, dropped


def dedupe(findings):
    seen, out = set(), []
    for f in findings:
        key = (f["check"], f["field"], norm(f["quote"]), f["source"].get("rule_id"))
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


def risk_level(findings):
    if any(f["severity"] == "red" for f in findings):
        return "red"
    if findings:
        return "amber"
    return "green"
