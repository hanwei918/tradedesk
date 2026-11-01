"""Rules knowledge base and product cards.

Every rule carries a verbatim excerpt and the URL it was copied from. Rules that
were not verified against their source are loaded but never used for checking.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KB_PATH = ROOT / "kb" / "rules.json"
PRODUCTS_PATH = ROOT / "data" / "products.json"
INQUIRIES_PATH = ROOT / "data" / "inquiries.json"
CHECK_MAP_PATH = ROOT / "config" / "check_map.json"
MARKETS_PATH = ROOT / "data" / "markets.json"

PLATFORM_NAMES = {
    "alibaba_rfq": "阿里巴巴国际站 · RFQ 回复",
    "amazon_us": "Amazon 美国站 · Listing",
    "tiktok_mx": "TikTok Shop 墨西哥 · 种草短视频",
    "amazon_uk": "Amazon 英国站 · Listing",
    "amazon_de": "Amazon 德国站 · Listing",
    "amazon_jp": "Amazon 日本站 · Listing",
    "ebay": "eBay · Listing",
    "shopify": "Shopify 独立站 · Listing",
    "etsy": "Etsy · Listing",
    "walmart_us": "Walmart 美国站 · Listing",
    "mercadolibre_mx": "Mercado Libre 墨西哥 · Listing",
    "aliexpress": "AliExpress · Listing",
}
PLATFORM_MARKET = {
    "alibaba_rfq": None,
    "amazon_us": "US", "amazon_uk": "UK", "amazon_de": "EU", "amazon_jp": "JP",
    "tiktok_mx": "MX", "walmart_us": "US", "mercadolibre_mx": "MX",
    "ebay": None, "shopify": None, "etsy": None, "aliexpress": None,
}


def _load(path, default):
    if not Path(path).exists():
        return default
    return json.loads(Path(path).read_text(encoding="utf-8"))


class KnowledgeBase:
    def __init__(self, rules_path=KB_PATH, products_path=PRODUCTS_PATH,
                 inquiries_path=INQUIRIES_PATH, check_map_path=CHECK_MAP_PATH, markets_path=MARKETS_PATH):
        kb = _load(rules_path, {"version": None, "rules": []})
        self.version = kb.get("version")
        self.all_rules = kb.get("rules", [])
        self.rules = {r["id"]: r for r in self.all_rules if r.get("verified") is True}
        self.all_rules_by_id = {r["id"]: r for r in self.all_rules}
        self.catalog = _load(products_path, {"factory": {}, "products": []})
        self.factory = self.catalog.get("factory", {})
        # A second demo factory (another product category) shows that switching means swapping the card, not the code.
        self.other_factories = {f["id"]: f for f in self.catalog.get("other_factories", [])}
        self.products = {p["id"]: p for p in self.catalog.get("products", [])}
        self.inquiries = _load(inquiries_path, {"inquiries": []}).get("inquiries", [])
        self.check_map = _load(check_map_path, {})
        self.markets = _load(markets_path, {"markets": {}}).get("markets", {})

    def product(self, product_id):
        if product_id not in self.products:
            raise KeyError(f"未知产品：{product_id}")
        return self.products[product_id]

    def factory_for(self, product):
        """The factory card a product belongs to; products without factory_id use the default factory."""
        return self.other_factories.get(product.get("factory_id"), self.factory)

    def market_profile(self, market, product_id):
        """What a market added after the US and Mexico needs from one product, or None.

        Only those markets have a profile, so prompts and checks for the US and Mexico stay
        exactly as they were (and their recorded answers still replay)."""
        m = self.markets.get(market)
        if not m:
            return None
        p = m.get("products", {}).get(product_id, {})
        return {"market": market, "name_zh": m.get("name_zh"), "power": m.get("power"), "plug": m.get("plug"),
                "certifications_not_held": p.get("certifications_not_held", []), "notes_zh": p.get("notes_zh", "")}

    def rule(self, rule_id):
        return self.rules.get(rule_id)

    def mapped_rule(self, check_name):
        """The verified KB rule a built-in check relies on, or None (check is then off)."""
        rule_id = self.check_map.get(check_name)
        return self.rules.get(rule_id) if rule_id else None

    def rules_for(self, platform, kinds=None, market=None):
        market = market or PLATFORM_MARKET.get(platform)
        out = []
        for r in self.rules.values():
            platforms = r.get("platforms") or []
            markets = r.get("markets") or ["ALL"]
            platform_ok = platform in platforms or not platforms or "all" in platforms
            market_ok = market is None or "ALL" in markets or market in markets
            if not (platform_ok and market_ok):
                continue
            kind = (r.get("check") or {}).get("kind")
            if kinds and kind not in kinds:
                continue
            if not kinds and kind == "reference":  # shown in the rule base with its source, never checked
                continue
            out.append(r)
        return sorted(out, key=lambda r: r["id"])

    @staticmethod
    def public(rule):
        return {k: rule.get(k) for k in
                ("id", "category", "title_zh", "summary_zh", "excerpt", "url", "source_type", "fetched")}
