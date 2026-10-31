"""Selectable destinations and output languages for product listings."""

LANGUAGES = {
    "en": {"name": "英语", "prompt": "English"},
    "es": {"name": "西班牙语", "prompt": "Spanish"},
    "zh": {"name": "中文", "prompt": "Simplified Chinese"},
    "de": {"name": "德语", "prompt": "German"},
    "ja": {"name": "日语", "prompt": "Japanese"},
    "ru": {"name": "俄语", "prompt": "Russian"},
}

LISTING_PLATFORMS = {
    "amazon_us": {"name": "Amazon 美国站", "kind": "amazon", "prompt": "listing_amazon", "role": "ops_amazon", "default_language": "en", "default_selected": True},
    "tiktok_mx": {"name": "TikTok Shop 墨西哥", "kind": "tiktok", "prompt": "listing_tiktok", "role": "ops_tiktok", "default_language": "es", "default_selected": True},
    "amazon_uk": {"name": "Amazon 英国站", "kind": "amazon", "prompt": "listing_amazon_uk", "role": "ops_amazon", "default_language": "en"},
    "amazon_de": {"name": "Amazon 德国站", "kind": "amazon", "prompt": "listing_amazon_de", "role": "ops_amazon", "default_language": "de"},
    "amazon_jp": {"name": "Amazon 日本站", "kind": "amazon", "prompt": "listing_amazon_jp", "role": "ops_amazon", "default_language": "ja"},
    "ebay": {"name": "eBay", "kind": "generic", "prompt": "listing_ebay", "role": "ops_ebay", "default_language": "en"},
    "shopify": {"name": "Shopify 独立站", "kind": "generic", "prompt": "listing_shopify", "role": "ops_shopify", "default_language": "en"},
    "etsy": {"name": "Etsy", "kind": "generic", "prompt": "listing_etsy", "role": "ops_etsy", "default_language": "en"},
    "walmart_us": {"name": "Walmart 美国站", "kind": "generic", "prompt": "listing_walmart_us", "role": "ops_walmart", "default_language": "en"},
    "mercadolibre_mx": {"name": "Mercado Libre 墨西哥", "kind": "generic", "prompt": "listing_mercadolibre_mx", "role": "ops_mercadolibre", "default_language": "es"},
    "aliexpress": {"name": "AliExpress", "kind": "generic", "prompt": "listing_aliexpress", "role": "ops_aliexpress", "default_language": "en"},
}


def public_catalog():
    return {
        "platforms": LISTING_PLATFORMS,
        "languages": LANGUAGES,
    }
