"""实时验证: run one inquiry nobody recorded through the whole reply flow, live, and keep the result.

Replay shows recorded answers. This proves a new input also runs end to end: understand,
reply and review are real model calls (never read from or written to the cache). Each run
is three calls and costs quota, so it only runs when someone presses the button. Results,
including failures, are kept in state/live_checks.json and the calls go to the call log.
"""

import json
import random
import time
from pathlib import Path

from .llm import LLMError
from .workflows import Runner

BUSINESS = ["home goods importer", "kitchenware wholesaler", "small appliance distributor", "online retailer"]
CITIES = ["Houston", "Monterrey", "Chicago", "Guadalajara", "Miami", "Phoenix"]
CERTS = ["UL listed", "ETL certified", "FDA approved", "BPA free"]
PAYMENTS = ["100% 60 days after delivery", "30% deposit, 70% before shipment", "L/C at sight", "net 30"]
NAMES = ["Alex", "Maria", "Daniel", "Sofia", "Chris", "Lucia"]


def sample_inquiry(product, rng=None):
    """A fresh English inquiry for a product; the random quantity, days and wording make the request new."""
    rng = rng or random.Random()
    return (f"Hi, we are a {rng.choice(BUSINESS)} in {rng.choice(CITIES)}. Please quote {rng.randrange(300, 5000, 50):,} pcs "
            f"of your {product['name_en']}, FOB Ningbo. We need it {rng.choice(CERTS)} and delivered within "
            f"{rng.randrange(15, 46)} days. Payment: {rng.choice(PAYMENTS)}. Thanks, {rng.choice(NAMES)}")


class LiveChecks:
    def __init__(self, path):
        self.path = Path(path)

    def load(self):
        return json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else []

    def _keep(self, record):
        items = (self.load() + [record])[-20:]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
        return record

    def run(self, kb, live_llm, product_id, text, log_path, board):
        """live_llm must be in live mode; the caller builds it from the saved model settings."""
        if live_llm.mode != "live":
            raise ValueError("实时验证必须用实时模式")
        if not live_llm.api_key:
            raise ValueError("没有配置 key：在左下角模型卡片里填 Tokenhub 的 key 再试")
        text = (text or "").strip()
        if not 20 <= len(text) <= 4000:
            raise ValueError("询盘要 20 到 4000 个字符")
        product = kb.product(product_id)
        record = {"ts": time.strftime("%Y-%m-%d %H:%M:%S"), "product_id": product_id, "text": text,
                  "provider": live_llm.provider, "model": live_llm.model}
        started = time.time()
        try:
            r = Runner(live_llm, kb, log_path=log_path, board=board).inquiry(
                {"inquiry_text": text, "product_id": product_id, "round": 1})
        except LLMError as exc:
            return self._keep(dict(record, ok=False, seconds=round(time.time() - started, 1), error=str(exc)))
        steps = [{"step": t["step"], "role": t["role"], "seconds": t["meta"]["seconds"], "source": t["meta"]["source"]}
                 for t in r["trace"]]
        return self._keep(dict(
            record, ok=bool(steps) and all(s["source"] == "live" for s in steps) and not r.get("review_skipped"),
            seconds=round(time.time() - started, 1), steps=steps, risk=r["risk"], findings=len(r["findings"]),
            conflicts=len((r.get("understanding") or {}).get("conflicts") or []),
            reply_head=(r.get("reply") or "")[:400], run_id=r["run_id"],
            error=(r.get("review_skipped") or {}).get("reason_zh")))
