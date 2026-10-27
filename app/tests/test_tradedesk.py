import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tradedesk import checks  # noqa: E402
from tradedesk.kb import KnowledgeBase  # noqa: E402
from tradedesk.llm import LLM, LLMError  # noqa: E402
from tradedesk.workflows import Runner, word_diff  # noqa: E402
from tradedesk.board import Board  # noqa: E402
from tradedesk import images  # noqa: E402

RULES = {
    "version": "test",
    "rules": [
        {"id": "IMG-01", "category": "platform_amazon_image", "platforms": ["amazon_us"], "markets": ["US"],
         "title_zh": "最长边", "excerpt": "x", "url": "https://example.test/i1", "verified": True,
         "check": {"kind": "image", "metric": "longest_side", "min": 500, "severity": "red"}},
        {"id": "IMG-03", "category": "platform_amazon_image", "platforms": ["amazon_us"], "markets": ["US"],
         "title_zh": "白底", "excerpt": "x", "url": "https://example.test/i3", "verified": True,
         "check": {"kind": "image", "metric": "white_border", "min": 0.98, "severity": "red"}},
        {"id": "IMG-04", "category": "platform_amazon_image", "platforms": ["amazon_us"], "markets": ["US"],
         "title_zh": "占比", "excerpt": "x", "url": "https://example.test/i4", "verified": True,
         "check": {"kind": "image", "metric": "fill", "min": 0.85, "severity": "amber"}},
        {"id": "IMG-05", "category": "platform_amazon_image", "platforms": ["amazon_us"], "markets": ["US"],
         "title_zh": "贴边", "excerpt": "x", "url": "https://example.test/i5", "verified": True,
         "check": {"kind": "image", "metric": "not_cropped", "severity": "amber"}},
        {"id": "IMG-09", "category": "platform_amazon_image", "platforms": ["amazon_us"], "markets": ["US"],
         "title_zh": "宣称", "excerpt": "x", "url": "https://example.test/i9", "verified": True,
         "check": {"kind": "vision", "question_zh": "有没有文字宣称"}},
        {"id": "AMZ-01", "category": "platform_amazon", "platforms": ["amazon_us"], "markets": ["US"],
         "title_zh": "标题长度", "excerpt": "x", "url": "https://example.test/a", "verified": True,
         "check": {"kind": "length", "field": "title", "max": 50}},
        {"id": "AMZ-02", "category": "platform_amazon", "platforms": ["amazon_us"], "markets": ["US"],
         "title_zh": "禁止促销用语", "excerpt": "x", "url": "https://example.test/b", "verified": True,
         "check": {"kind": "regex", "field": "any", "pattern": "(?i)\\bbest seller\\b", "message_zh": "促销用语"}},
        {"id": "AMZ-03", "category": "platform_amazon", "platforms": ["amazon_us"], "markets": ["US"],
         "title_zh": "未核实规则", "excerpt": "x", "url": "https://example.test/c", "verified": False,
         "check": {"kind": "regex", "field": "any", "pattern": "(?i)kettle", "message_zh": "不应出现"}},
        {"id": "INC-01", "category": "contract", "platforms": ["alibaba_rfq"], "markets": ["ALL"],
         "title_zh": "FOB 仅限海运", "excerpt": "sea and inland waterway", "url": "https://example.test/d",
         "verified": True, "check": {"kind": "llm", "question_zh": "术语用法"}},
        {"id": "US-01", "category": "compliance_us", "platforms": ["amazon_us"], "markets": ["US"],
         "title_zh": "环保宣称", "excerpt": "x", "url": "https://example.test/e", "verified": True,
         "check": {"kind": "llm", "question_zh": "是否有笼统环保宣称"}},
    ],
}


def make_kb(tmp, check_map=None):
    tmp = Path(tmp)
    (tmp / "rules.json").write_text(json.dumps(RULES), encoding="utf-8")
    (tmp / "map.json").write_text(json.dumps(check_map or {"fob_sea_only": "INC-01"}), encoding="utf-8")
    return KnowledgeBase(rules_path=tmp / "rules.json", check_map_path=tmp / "map.json")


class FakeTransport:
    """Answers by which prompt is being used; records every request."""

    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def __call__(self, body):
        system = body["messages"][0]["content"]
        self.calls.append(body)
        for marker, answer in self.answers.items():
            if marker in system:
                return json.dumps(answer(body) if callable(answer) else answer)
        raise AssertionError("unexpected prompt: " + system[:40])


class CheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.kb = make_kb(self.tmp.name)
        self.kettle = self.kb.product("KET-17S")
        self.fryer = self.kb.product("AF-45D")

    def tearDown(self):
        self.tmp.cleanup()

    def kinds(self, text, product=None, platform="alibaba_rfq"):
        fs = checks.run_rule_checks({"reply": text}, product or self.kettle, self.kb, platform)
        return [(f["check"], f["severity"]) for f in fs]

    def test_claiming_a_certification_the_factory_lacks_is_red(self):
        self.assertIn(("fact_cert", "red"), self.kinds("Our kettle is UL listed and ready to ship."))

    def test_decimal_point_does_not_split_a_sentence(self):
        fs = checks.run_rule_checks({"reply": "BEST SELLER!! 1.7L Kettle, BPA Free, UL Listed"}, self.kettle, self.kb, "alibaba_rfq")
        self.assertEqual(sorted(f["quote"] for f in fs), ["BPA Free", "UL Listed"])

    def test_mentions_that_are_not_claims_are_not_flagged(self):
        # Sentences taken from a real recorded reply that honestly declined UL / BPA.
        for text in ["If UL is a must for your Amazon listing, please let me know.",
                     "Please confirm whether UL and BPA free are mandatory for your project.",
                     "We can check with our engineering team whether a UL application for this model is possible.",
                     "¿La certificación NOM es indispensable para su proyecto?",
                     "Your target price of USD 20 is below our cost.",
                     "We are not able to reach USD 5.00 on this model.",
                     "BPA free",
                     "Sabemos que para su venta en México el hervidor debe certificarse bajo la NOM-003-SCFI-2014.",
                     "Definir juntos el plan para la certificación NOM."]:
            self.assertEqual(self.kinds(text), [], text)
        self.assertEqual(self.kinds("Our kettle is UL certified."), [("fact_cert", "red")])
        self.assertEqual(self.kinds("Contamos con certificación NOM."), [("fact_cert", "red")])
        self.assertEqual(self.kinds("Estamos en disposición de colaborar con ustedes para obtener la certificación NOM."),
                         [("fact_cert", "amber")])
        self.assertEqual(self.kinds("Price: USD 5.00 per unit."), [("fact_price", "red")])

    def test_fixes_found_by_the_first_blind_set(self):
        # H16: denial followed by an offer is still an offer
        self.assertEqual(self.kinds("Actualmente no contamos con la NOM, pero podemos colaborar con usted para obtener la certificación NOM."),
                         [("fact_cert", "amber")])
        # H18: Spanish air freight
        self.assertEqual(self.kinds("Podemos enviarlo FOB Ningbo por avión."), [("contract_incoterm", "amber")])
        # H21: a heading line ending with a colon is a label, not a claim
        self.assertEqual(self.kinds("Certification (UL / ETL):"), [])

    def test_fixes_found_by_the_second_blind_set(self):
        self.assertEqual(self.kinds("Yes sir, this kettle is UL listed, so no problem for US retail."), [("fact_cert", "red")])
        self.assertEqual(self.kinds("Our MOQ 500 pcs, lead time 35 days."), [])        # 500 is the kettle MOQ
        fryer = self.fryer
        self.assertEqual(self.kinds("MOQ 1000 pcs, lead time 35-40 days.", fryer), [])  # was read as "MOQ 100"
        self.assertEqual(self.kinds("For the balance, you can pay 60 days after the goods arrive in LA."), [("fact_payment", "red")])
        self.assertEqual(self.kinds("We'll send by air on FOB Ningbo terms."), [("contract_incoterm", "amber")])
        self.assertEqual(self.kinds("This model is not UL listed, and it does not have ETL either."), [])

    def test_honestly_saying_no_certification_is_not_flagged(self):
        self.assertEqual(self.kinds("Currently we do not have UL certification."), [])

    def test_offering_to_apply_is_amber_not_red(self):
        self.assertEqual(self.kinds("We can help apply for NOM certification for your market."), [("fact_cert", "amber")])

    def test_unproven_material_claims(self):
        self.assertIn(("fact_material", "red"), self.kinds("The lid is BPA free."))
        self.assertIn(("fact_material", "red"), self.kinds("La tapa es libre de BPA."))
        self.assertEqual(self.kinds("We cannot confirm BPA free status yet."), [])
        self.assertIn(("fact_material", "red"), self.kinds("PTFE-free basket included.", self.fryer))

    def test_price_below_floor_is_red_and_tier_price_is_fine(self):
        self.assertIn(("fact_price", "red"), self.kinds("Price: USD 8.20 per unit FOB Ningbo."))
        self.assertEqual(self.kinds("Price: USD 9.20 per unit FOB Ningbo."), [])

    def test_lead_time_and_moq(self):
        self.assertIn(("fact_lead", "amber"), self.kinds("Delivery within 20 days after deposit."))
        self.assertEqual(self.kinds("Delivery within 35 days after deposit."), [])
        self.assertIn(("fact_moq", "red"), self.kinds("Our MOQ is 300 pcs."))

    def test_payment_after_delivery(self):
        self.assertIn(("fact_payment", "red"), self.kinds("OK, payment 60 days after delivery is fine."))
        self.assertEqual(self.kinds("Sorry, we cannot accept payment after delivery."), [])

    def test_payment_talk_for_later_is_amber_not_red(self):
        # Found in the comparison run: offering to discuss open account later is not accepting it now.
        later = "Once we build a steady relationship, we would be glad to discuss open account terms for repeat orders."
        self.assertEqual(self.kinds(later), [("fact_payment", "amber")])
        self.assertIn(("fact_payment", "red"),
                      self.kinds("We accept payment 60 days after delivery for this long-term partnership."))

    def test_fob_by_air_needs_the_mapped_rule(self):
        self.assertIn(("contract_incoterm", "amber"), self.kinds("We quote FOB Ningbo by air."))
        self.assertEqual(self.kinds("FOB Ningbo by sea; by air we suggest FCA Ningbo."), [])
        with tempfile.TemporaryDirectory() as t:
            kb = make_kb(t, check_map={"unused": "X"})
            fs = checks.run_rule_checks({"reply": "We quote FOB Ningbo by air."}, self.kettle, kb, "alibaba_rfq")
            self.assertEqual(fs, [], "no source rule -> the check must not run")

    def test_kb_rules_apply_only_to_their_platform_and_only_when_verified(self):
        fields = {"title": "Best Seller Electric Kettle 1.7L stainless steel with auto shut off and more"}
        fs = checks.run_rule_checks(fields, self.kettle, self.kb, "amazon_us")
        ids = sorted(f["source"]["rule_id"] for f in fs)
        self.assertEqual(ids, ["AMZ-01", "AMZ-02"])  # AMZ-03 is unverified -> never used
        self.assertEqual(checks.run_rule_checks(fields, self.kettle, self.kb, "alibaba_rfq"), [])

    def test_every_finding_has_a_source(self):
        fs = checks.run_rule_checks({"reply": "UL listed, BPA free, USD 5.00, MOQ 100, FOB by air, net 60."},
                                    self.kettle, self.kb, "alibaba_rfq")
        self.assertTrue(fs)
        for f in fs:
            self.assertIn(f["source"]["type"], ("kb", "product_card"))

    def test_model_guard(self):
        allowed = self.kb.rules_for("amazon_us", kinds=["llm"])
        fields = {"title": "Eco-friendly kettle for your kitchen"}
        raw = [
            {"rule_id": "US-01", "quote": "Eco-friendly kettle", "severity": "red", "problem_zh": "笼统环保宣称"},
            {"rule_id": "US-99", "quote": "Eco-friendly", "severity": "red"},           # invented rule
            {"rule_id": "US-01", "quote": "100% recyclable", "severity": "red"},        # quote not in text
            {"rule_id": "US-01", "quote": "", "severity": "red"},                       # no quote
            "not a dict",
        ]
        kept, dropped = checks.guard_model_findings(raw, allowed, fields)
        self.assertEqual([k["quote"] for k in kept], ["Eco-friendly kettle"])
        self.assertEqual(len(dropped), 4)
        self.assertEqual(kept[0]["source"]["url"], "https://example.test/e")

    def test_model_guard_caps_culture_rules_at_amber(self):
        # Found in the comparison run: the model called an emoji in a Mexican reply red.
        allowed = [{"id": "CUL-01", "category": "culture", "title_zh": "正式语气"},
                   {"id": "ALI-03", "category": "platform_alibaba", "title_zh": "信息真实"}]
        fields = {"reply": "Muchas gracias 😊. Free samples for everyone."}
        raw = [{"rule_id": "CUL-01", "quote": "Muchas gracias 😊", "severity": "red"},
               {"rule_id": "ALI-03", "quote": "Free samples", "severity": "red"}]
        kept, _ = checks.guard_model_findings(raw, allowed, fields)
        self.assertEqual([k["severity"] for k in kept], ["amber", "red"])

    def test_risk_level(self):
        self.assertEqual(checks.risk_level([]), "green")
        self.assertEqual(checks.risk_level([{"severity": "amber"}]), "amber")
        self.assertEqual(checks.risk_level([{"severity": "amber"}, {"severity": "red"}]), "red")


class LLMCacheTests(unittest.TestCase):
    def test_record_then_replay_returns_the_same_answer_without_network(self):
        with tempfile.TemporaryDirectory() as t:
            live = LLM(api_key="k", mode="record", cache_dir=t, transport=lambda body: '{"a": 1}', provider="openai")
            self.assertEqual(live.chat_json("s", "u")[0], {"a": 1})
            offline = LLM(api_key="", mode="replay", cache_dir=t, provider="openai",
                          transport=lambda body: (_ for _ in ()).throw(AssertionError("network used")))
            data, meta = offline.chat_json("s", "u")
            self.assertEqual((data, meta["source"]), ({"a": 1}, "replay"))
            with self.assertRaises(LLMError):
                offline.chat_json("s", "a different request")

    def test_non_json_answer_is_an_error(self):
        with tempfile.TemporaryDirectory() as t:
            llm = LLM(api_key="k", mode="live", cache_dir=t, transport=lambda body: "not json", provider="openai")
            with self.assertRaises(LLMError):
                llm.chat_json("s", "u")


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.kb = make_kb(self.tmp.name)
        self.inquiry = self.kb.inquiries[0]

    def tearDown(self):
        self.tmp.cleanup()

    def runner(self, answers):
        transport = FakeTransport(answers)
        llm = LLM(api_key="k", mode="live", cache_dir=self.tmp.name, transport=transport, provider="openai")
        return Runner(llm, self.kb, log_path=Path(self.tmp.name) / "calls.jsonl",
                      board=Board(Path(self.tmp.name) / "state")), transport

    def test_inquiry_round_trip(self):
        understanding = {
            "buyer": {"language": "en"},
            "requests": [{"topic_zh": "数量", "value": "1200", "quote": "1,200 pcs for first order"},
                         {"topic_zh": "认证", "value": "UL", "quote": "a sentence that is not in the inquiry"}],
            "signals": [], "conflicts": [], "summary_zh": "x",
        }
        replies = iter([
            {"reply": "Dear Mark, our kettle is UL listed. Price USD 9.80 FOB Ningbo.", "internal_brief_zh": "备忘"},
            {"reply": "Dear Mark, we do not have UL yet. Price USD 9.80 FOB Ningbo by sea.", "internal_brief_zh": "备忘"},
        ])
        review = {"findings": [{"rule_id": "INC-01", "quote": "FOB Ningbo", "severity": "amber", "problem_zh": "p"},
                               {"rule_id": "MADE-UP", "quote": "Dear Mark", "severity": "red"}]}
        runner, transport = self.runner({"询盘分析员": understanding, "外贸业务员": lambda b: next(replies),
                                         "合规审核员": review})
        payload = {"inquiry_text": self.inquiry["text"], "intent_zh": self.inquiry["intent_zh"],
                   "product_id": "KET-17S", "round": 1}
        r1 = runner.inquiry(payload)
        self.assertEqual(len(r1["understanding"]["requests"]), 1)
        self.assertEqual(r1["understanding"]["dropped_without_quote"], 1)
        self.assertEqual(r1["risk"], "red")
        self.assertIn("fact_cert", [f["check"] for f in r1["findings"]])
        self.assertEqual(len(r1["dropped"]), 1)  # MADE-UP rule id dropped

        r2 = runner.inquiry(dict(payload, understanding=r1["understanding"], previous={"reply": r1["reply"]},
                                 instruction_zh="按风险提示全部修改", round=2))
        self.assertNotIn("fact_cert", [f["check"] for f in r2["findings"]])
        self.assertTrue(any(o["op"] == "insert" for o in r2["diff"]))
        self.assertIn("上一版回复", transport.calls[-2]["messages"][1]["content"])
        log = (Path(self.tmp.name) / "calls.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertGreaterEqual(len(log), 6)

    def test_listing_both_platforms(self):
        amazon = {"title": "Best Seller [Brand] Electric Kettle 1.7L Stainless Steel Auto Shut-Off",
                  "bullets": ["A", "B", "C", "D", "E"], "description": "d", "search_terms": "s"}
        tiktok = {"hook": "¡Mira esto!", "script": [{"shot_zh": "镜头", "line": "Hierve rápido"}],
                  "caption": "c", "hashtags": ["#cocina"]}
        runner, _ = self.runner({"Amazon US": amazon, "TikTok Shop": tiktok, "合规审核员": {"findings": []}})
        r = runner.listing({"product_id": "KET-17S", "round": 1})
        self.assertEqual(set(r["platforms"]), {"amazon_us", "tiktok_mx"})
        amz = r["platforms"]["amazon_us"]
        self.assertEqual(sorted(f["source"]["rule_id"] for f in amz["findings"]), ["AMZ-01", "AMZ-02"])
        self.assertEqual(r["platforms"]["tiktok_mx"]["risk"], "green")


class ReviewFallbackTests(unittest.TestCase):
    def test_model_failure_keeps_rule_findings_and_is_never_green(self):
        with tempfile.TemporaryDirectory() as t:
            kb = make_kb(t)
            llm = LLM(api_key="", mode="replay", cache_dir=t, provider="openai")  # nothing cached -> every call fails
            runner = Runner(llm, kb, log_path=Path(t) / "calls.jsonl", board=Board(Path(t) / "state"))
            r = runner.check_text({"platform": "amazon_us", "product_id": "KET-17S", "text": "Best seller kettle"})
            self.assertEqual([f["source"]["rule_id"] for f in r["findings"]], ["AMZ-02"])
            self.assertIsNotNone(r["review_skipped"])
            clean = runner.check_text({"platform": "amazon_us", "product_id": "KET-17S", "text": "Kettle"})
            self.assertEqual((clean["findings"], clean["risk"]), ([], "amber"))


def png(size, bg, box=None, color=(20, 20, 20)):
    """A test image: solid background with an optional dark rectangle (x0, y0, x1, y1)."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", size, bg)
    if box:
        ImageDraw.Draw(im).rectangle(box, fill=color)
    buf = __import__("io").BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def data_url(raw):
    return "data:image/png;base64," + __import__("base64").b64encode(raw).decode()


@unittest.skipIf(images.Image is None, "Pillow not installed")
class ImageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.kb = make_kb(self.tmp.name)
        self.rules = [r for r in self.kb.rules_for("amazon_us", kinds=["image"])]

    def tearDown(self):
        self.tmp.cleanup()

    def ids(self, raw):
        return sorted(f["source"]["rule_id"] for f in images.pixel_findings(images.measure(raw), self.rules))

    def test_compliant_image_passes_pixel_checks(self):
        self.assertEqual(self.ids(png((1200, 1200), (255, 255, 255), (60, 60, 1140, 1140))), [])

    def test_small_coloured_and_underfilled_images_fail(self):
        self.assertEqual(self.ids(png((400, 400), (255, 255, 255), (20, 20, 380, 380))), ["IMG-01"])
        # A coloured background fails IMG-03 only; fill/edge estimates are meaningless there and must not run.
        self.assertEqual(self.ids(png((1200, 1200), (230, 240, 255), (60, 60, 1140, 1140))), ["IMG-03"])
        self.assertEqual(self.ids(png((1200, 1200), (255, 255, 255), (400, 400, 800, 800))), ["IMG-04"])

    def test_vision_guard(self):
        vision = self.kb.rules_for("amazon_us", kinds=["vision"])
        kept, dropped = images.guard_vision_findings([
            {"rule_id": "IMG-09", "evidence_zh": "底部黑条上写着 FREE SHIPPING", "severity": "red"},
            {"rule_id": "IMG-99", "evidence_zh": "看到了", "severity": "red"},
            {"rule_id": "IMG-09", "evidence_zh": "", "severity": "red"},
        ], vision)
        self.assertEqual([k["source"]["rule_id"] for k in kept], ["IMG-09"])
        self.assertEqual(len(dropped), 2)

    def test_image_check_workflow_updates_board(self):
        transport = FakeTransport({"主图审核员": {"findings": [
            {"rule_id": "IMG-09", "evidence_zh": "图上有 FREE SHIPPING 字样", "severity": "red", "problem_zh": "促销宣称"},
            {"rule_id": "NOPE", "evidence_zh": "x", "severity": "red"}]}})
        llm = LLM(api_key="k", mode="live", cache_dir=self.tmp.name, transport=transport, provider="openai")
        board = Board(Path(self.tmp.name) / "state")
        runner = Runner(llm, self.kb, log_path=Path(self.tmp.name) / "calls.jsonl", board=board)
        raw = png((1200, 1200), (255, 255, 255), (60, 60, 1140, 1140))
        r = runner.image_check({"product_id": "KET-17S", "image": data_url(raw)})
        self.assertEqual((r["risk"], len(r["dropped"])), ("red", 1))
        sent = transport.calls[0]["messages"][1]["content"]
        self.assertEqual(sent[0]["type"], "image_url")  # the picture really goes to the model
        cell = board.snapshot(["KET-17S"])[0]["cells"]["image"]
        self.assertEqual(cell["status"], "不能发")
        self.assertIsNotNone(board.image_path("KET-17S"))


class BoardTests(unittest.TestCase):
    def test_statuses_and_listing_guard(self):
        with tempfile.TemporaryDirectory() as t:
            b = Board(Path(t))
            self.assertEqual(b.snapshot(["P"])[0]["cells"]["amazon_us"]["status"], "未生成")
            b.record("P", "amazon_us", {"risk": "red", "findings": [{"severity": "red"}]}, "r1")
            with self.assertRaises(ValueError):
                b.mark_listed("P", "amazon_us")
            b.record("P", "amazon_us", {"risk": "amber", "findings": [{"severity": "amber"}]}, "r2")
            self.assertEqual(b.mark_listed("P", "amazon_us")["status"], "已上架")
            with self.assertRaises(ValueError):
                b.mark_listed("P", "tiktok_mx")


class EvalTests(unittest.TestCase):
    def test_dev_set_passes_and_labels_map(self):
        from tradedesk.evaluate import evaluate
        res = evaluate(KnowledgeBase())  # the real KB and products, as the eval page uses them
        dev = res["sets"]["dev"]
        failing = [r["id"] for r in dev["results"] if not r["pass"]]
        self.assertEqual(failing, [], "every dev case is a regression guard")
        self.assertGreater(dev["summary"]["tp"], 10)

    def test_without_does_not_cancel_a_material_claim(self):
        kb = KnowledgeBase()
        fs = checks.run_rule_checks({"bullets[1]": "PTFE-FREE BASKET: cook without worries."},
                                    kb.product("AF-45D"), kb, "amazon_us")
        self.assertIn("fact_material", [f["check"] for f in fs])


class InboxTests(unittest.TestCase):
    def test_priority_is_plain_arithmetic_over_quoted_facts(self):
        from tradedesk.inbox import priority
        u = {"signals": [{"signal_zh": "给出具体数量", "positive": True, "quote": "3,200 units"},
                         {"signal_zh": "说明了渠道", "positive": True, "quote": "hotel group"}],
             "conflicts": [{"topic_zh": "认证", "severity": "red", "quote": "ETL or UL"}],
             "requests": [{"topic_zh": "数量", "value": "3,200 units", "quote": "3,200 units"}]}
        p = priority(u, {"moq_units": 800})
        self.assertEqual((p["score"], p["level"]), (50 + 16 - 6 + 15, "高"))
        low = priority({"signals": [{"signal_zh": "空泛", "positive": False, "quote": "x"}],
                        "requests": [{"topic_zh": "数量", "value": "100 piezas", "quote": "100"}]}, {"moq_units": 1000})
        self.assertEqual((low["score"], low["level"]), (50 - 8 - 10, "低"))

    def test_task_guard(self):
        from tradedesk.inbox import guard_tasks
        kept, dropped = guard_tasks([
            {"role_zh": "采购", "task_zh": "询 BPA 检测报价", "quote": "BPA free"},
            {"role_zh": "老板", "task_zh": "x", "quote": "BPA free"},          # unknown role
            {"role_zh": "生产", "task_zh": "加急", "quote": "in 10 days"},       # quote not in inquiry
        ], "Need it UL listed and BPA free.", checks.norm)
        self.assertEqual([k["role_zh"] for k in kept], ["采购"])
        self.assertEqual(dropped, 2)

    def test_reply_creates_tasks_and_marks_inbox(self):
        with tempfile.TemporaryDirectory() as t:
            kb = make_kb(t)
            q = kb.inquiries[0]
            transport = FakeTransport({
                "询盘分析员": {"buyer": {"language": "en"}, "requests": [], "signals": [], "conflicts": [], "summary_zh": "x"},
                "外贸业务员": {"reply": "Dear Mark, we do not have UL.", "internal_brief_zh": "备忘",
                           "tasks": [{"role_zh": "采购", "task_zh": "询 BPA 检测报价", "quote": "BPA free", "priority": "high"},
                                     {"role_zh": "生产", "task_zh": "x", "quote": "not in the inquiry"}]},
                "合规审核员": {"findings": []}})
            llm = LLM(api_key="k", mode="live", cache_dir=t, transport=transport, provider="openai")
            runner = Runner(llm, kb, log_path=Path(t) / "calls.jsonl", board=Board(Path(t) / "state"))
            r = runner.inquiry({"inquiry_text": q["text"], "intent_zh": "", "product_id": q["product_id"],
                                "round": 1, "inquiry_id": q["id"]})
            self.assertEqual((len(r["tasks"]), r["tasks_dropped"]), (1, 1))
            self.assertEqual([x["task_zh"] for x in runner.inbox.tasks()], ["询 BPA 检测报价"])
            self.assertEqual(runner.inbox.inbox()[q["id"]]["reply"]["round"], 1)
            with self.assertRaises(ValueError):
                runner.inbox.set_task_status(runner.inbox.tasks()[0]["id"], "随便")


class FairGroundTests(unittest.TestCase):
    def test_phones_on_the_lan_only_reach_the_game(self):
        import server
        allowed = ["/play", "/play.html", "/play.js", "/style.css?v=10", "/icons.svg", "/vendor/qrcode.js",
                   "/api/play/check", "/api/play/leaderboard"]
        blocked = ["/", "/index.html", "/api/inquiry", "/api/listing", "/api/board", "/api/meta",
                   "/api/image-check", "/api/board/export.csv", "/api/playx", "/play/../api/meta", "/vendor/..", "/vendor/../index.html"]
        self.assertTrue(all(server.LAN_ALLOWED.match(p) for p in allowed))
        self.assertFalse(any(server.LAN_ALLOWED.match(p) for p in blocked))

    def test_handler_blocks_non_loopback_clients(self):
        import server
        sent = []

        def fake(addr, path):
            h = server.Handler.__new__(server.Handler)  # no socket needed to test the gate
            h.client_address, h.path = (addr, 5555), path
            h._json = lambda code, obj: sent.append(code)
            return h._lan_blocked()
        self.assertTrue(fake("192.168.0.9", "/api/inquiry"))
        self.assertEqual(sent, [403])
        self.assertFalse(fake("192.168.0.9", "/api/play/check"))
        self.assertFalse(fake("127.0.0.1", "/api/inquiry"))
        self.assertFalse(fake("::1", "/api/meta"))

    def test_game_scores_taps_against_rule_findings(self):
        import server
        app = server.App()
        r = app.play_check({"id": "P2", "taps": [[29, 31]]})  # taps "UL"
        self.assertGreaterEqual(r["total"], 5)
        self.assertEqual(r["found"], 1)
        self.assertEqual(app.play_check({"id": "P2", "taps": []})["found"], 0)


class SettingsTests(unittest.TestCase):
    def setUp(self):
        from tradedesk import settings
        self.s = settings
        self.tmp = tempfile.TemporaryDirectory()
        self.env = Path(self.tmp.name) / ".env"
        self.env.write_text("# my note\nOTHER=1\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_key_is_stored_but_never_returned(self):
        self.s.save({"provider": "openai", "endpoint": "https://hub.example/v1/chat/completions",
                     "model": "m1", "api_key": "sk-test-1234567890abcd", "mode": "live"}, self.env)
        text = self.env.read_text(encoding="utf-8")
        self.assertIn("LLM_API_KEY=sk-test-1234567890abcd", text)
        self.assertIn("OTHER=1", text)                      # unrelated lines kept
        self.assertEqual(oct(self.env.stat().st_mode & 0o777), "0o600")
        view = self.s.public_view(self.env)
        self.assertNotIn("sk-test-1234567890abcd", json.dumps(view))
        self.assertEqual((view["key_set"], view["key_hint"]), (True, "…abcd"))

    def test_saved_key_never_follows_a_new_endpoint(self):
        self.s.save({"provider": "openai", "endpoint": "https://hub.example/v1/chat/completions",
                     "model": "m1", "api_key": "sk-test-1234567890abcd", "mode": "live"}, self.env)
        with self.assertRaises(ValueError):          # live needs a key, the old one is not carried over
            self.s.save({"endpoint": "https://evil.example/v1/chat/completions"}, self.env)
        v = self.s.save({"endpoint": "https://evil.example/v1/chat/completions", "mode": "replay"}, self.env)
        self.assertEqual(v["api_key"], "")
        self.assertNotIn("sk-test", self.env.read_text(encoding="utf-8"))
        # same endpoint, empty key field = keep the saved key
        self.s.save({"api_key": "sk-new-key-0000000001", "mode": "live"}, self.env)
        self.assertEqual(self.s.save({"model": "m2"}, self.env)["api_key"], "sk-new-key-0000000001")

    def test_rejects_bad_input(self):
        for bad in [{"endpoint": "http://evil.example/x"}, {"provider": "other"}, {"mode": "turbo"},
                    {"api_key": "two words"}, {"model": "a b"}]:
            with self.assertRaises(ValueError, msg=bad):
                self.s.save(dict({"mode": "replay"}, **bad), self.env)


class CrossSiteTests(unittest.TestCase):
    def gate(self, path, method="POST", host="127.0.0.1:8765", origin=None, ctype="application/json"):
        import server
        h = server.Handler.__new__(server.Handler)
        h.client_address, h.path, h.command = ("127.0.0.1", 5555), path, method
        h.headers = {k: v for k, v in {"Host": host, "Origin": origin, "Content-Type": ctype}.items() if v is not None}
        sent = []
        h._json = lambda code, obj: sent.append(code)
        return h._cross_site(), sent

    def test_local_page_passes(self):
        self.assertEqual(self.gate("/api/settings", origin="http://127.0.0.1:8765"), (False, []))
        self.assertEqual(self.gate("/api/settings", method="GET", ctype=None)[0], False)

    def test_forged_requests_are_refused(self):
        self.assertEqual(self.gate("/api/settings", origin="https://evil.example"), (True, [403]))
        self.assertEqual(self.gate("/api/settings", host="evil.example:8765")[0], True)   # DNS rebinding
        self.assertEqual(self.gate("/api/settings", ctype="text/plain")[0], True)         # form post without preflight
        self.assertEqual(self.gate("/api/inquiry", origin="http://evil.example")[0], True)

    def test_game_is_exempt(self):
        self.assertEqual(self.gate("/api/play/score", host="192.168.0.3:8765")[0], False)


class CompareAndRedTeamTests(unittest.TestCase):
    def test_summary_counts_replies_and_sources(self):
        from tradedesk.compare import summarize
        red_rule = {"check": "fact_cert", "severity": "red", "source": {"type": "product_card"}, "by": "rule"}
        red_model = {"check": "model_review", "severity": "red", "source": {"rule_id": "ALI-02"}, "by": "model"}
        amber = {"check": "fact_lead", "severity": "amber", "source": {}, "by": "rule"}
        s = summarize({"plain": [{"findings": [red_rule, red_model], "risk": "red"},
                                 {"findings": [amber], "risk": "amber"},
                                 {"findings": [], "risk": "green"}]})["plain"]
        self.assertEqual((s["replies"], s["replies_with_red"], s["replies_green"], s["red"], s["amber"]), (3, 1, 1, 2, 1))
        self.assertEqual((s["red_by_rules"], s["red_by_model"]), (1, 1))
        self.assertEqual(s["red_by_label"], {"CERT": 1, "模型:ALI-02": 1})

    def test_baseline_rejects_unknown_variant(self):
        with tempfile.TemporaryDirectory() as t:
            kb = make_kb(t)
            runner = Runner(LLM(api_key="", mode="replay", cache_dir=t, provider="openai"), kb,
                            log_path=Path(t) / "c.jsonl", board=Board(Path(t) / "state"))
            with self.assertRaises(ValueError):
                runner.baseline({"inquiry_id": kb.inquiries[0]["id"], "variant": "cheat"})

    def test_red_team_preset_drops_every_fabrication(self):
        import server
        r = server.App().redteam_run({})
        self.assertEqual([x["kept"] for x in r["results"]], [False, False, False, False, False, True])
        custom = server.App().redteam_run({"findings": [{"rule_id": "INC-01", "quote": "totally invented sentence", "severity": "red"}]})
        self.assertEqual(custom["kept"], 0)
        with self.assertRaises(ValueError):
            server.App().redteam_run({"findings": "not a list"})


class CostTests(unittest.TestCase):
    def test_replayed_runs_count_once_and_price_per_million(self):
        from tradedesk.cost import inquiry_runs, summarize, usd
        self.assertEqual(usd("claude-opus-5-5", 1_000_000, 0), 4.0)
        self.assertEqual(usd("claude-opus-5-5", 0, 1_000_000), 20.0)
        self.assertIsNone(usd("some/tokenhub-model", 10, 10))

        def step(run, name, key, i, o):
            return {"run_id": run, "workflow": "A 询盘回复", "step": name, "input_preview": "Hi, need 500 kettles UL listed",
                    "meta": {"cache_key": key, "model": "claude-opus-5-5", "usage": {"input_tokens": i, "output_tokens": o}}}
        rows = [step("r1", "理解询盘", "k1", 1000, 500), step("r1", "生成回复 · 第 1 轮", "k2", 2000, 1000),
                step("r9", "理解询盘", "k1", 1000, 500), step("r9", "生成回复 · 第 1 轮", "k2", 2000, 1000),  # replay
                step("r2", "生成回复 · 第 2 轮", "k3", 3000, 500)]
        per = inquiry_runs(rows, [{"id": "Q1", "text": "Hi, need 500 kettles UL listed"}])
        self.assertEqual(len(per["Q1"]["round1"]), 1)
        self.assertEqual(per["Q1"]["round1"][0]["usd"], round((3000 * 4 + 1500 * 20) / 1e6, 4))
        s = summarize(per)
        self.assertEqual((s["inquiries"], s["inquiries_with_revision"]), (1, 1))
        self.assertEqual(s["usd_round1_plus_revision"]["median"], round(0.042 + 0.022, 4))


class DiffTests(unittest.TestCase):
    def test_word_diff(self):
        ops = word_diff("UL listed kettle", "kettle without UL")
        self.assertEqual("".join(o["text"] for o in ops if o["op"] != "delete"), "kettle without UL")
        self.assertEqual("".join(o["text"] for o in ops if o["op"] != "insert"), "UL listed kettle")


if __name__ == "__main__":
    unittest.main()
