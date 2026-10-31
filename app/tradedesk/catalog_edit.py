"""Products created in the app (新增商品).

A merchant fills in a product card on the board; it is checked here, stored in
state/custom_products.json and merged into the knowledge base, so listing, checks,
inquiries and the board use it like any other product. The demo cards in
data/products.json are never edited (their recorded answers must keep replaying):
"从现有商品复制" starts a new card from one of them instead. New cards have no
recorded answers, so generating copy for them needs live mode.
"""

import json
import re
from pathlib import Path

from .checks import CERT_PATTERNS, MATERIAL_CLAIMS

KNOWN_NOT_HELD = list(CERT_PATTERNS)                 # certifications the code rules can spot in text
MATERIALS = [name for name, _ in MATERIAL_CLAIMS]    # claims the code rules can spot (BPA, PTFE, PFOA)


def _text(v, limit, field, required=False):
    v = re.sub(r"\s+", " ", str(v or "")).strip()
    if required and not v:
        raise ValueError(f"{field}不能为空")
    if len(v) > limit:
        raise ValueError(f"{field}太长（最多 {limit} 字）")
    return v


def _lines(v, limit_items, limit_len, field):
    items = v if isinstance(v, list) else re.split(r"[\n,，;；]+", str(v or ""))
    out = [_text(x, limit_len, field) for x in items]
    out = [x for x in out if x]
    if len(out) > limit_items:
        raise ValueError(f"{field}最多 {limit_items} 条")
    return list(dict.fromkeys(out))


def _pairs(v, field):
    """'容量: 1.5L' lines -> {"容量": "1.5L"} (dict input is accepted as is)."""
    if isinstance(v, dict):
        items = list(v.items())
    else:
        items = []
        for line in str(v or "").splitlines():
            if not line.strip():
                continue
            m = re.match(r"\s*([^:：=]+?)\s*[:：=]\s*(.+)$", line)
            if not m:
                raise ValueError(f"{field}每行写成“名称: 内容”，这一行看不懂：{line.strip()[:30]}")
            items.append((m.group(1), m.group(2)))
    if len(items) > 20:
        raise ValueError(f"{field}最多 20 项")
    return {_text(k, 40, field): _text(val, 200, field) for k, val in items}


def validate(raw, kb):
    """A product card from the form, or ValueError with a message the merchant can act on."""
    if not isinstance(raw, dict):
        raise ValueError("商品资料格式不对")
    factory_id = raw.get("factory_id") or None
    if factory_id and factory_id not in kb.other_factories:
        raise ValueError(f"未知工厂：{factory_id}")
    try:
        moq = int(str(raw.get("moq_units", "")).replace(",", "").strip())
    except ValueError:
        raise ValueError("MOQ 要填整数") from None
    if not 1 <= moq <= 10_000_000:
        raise ValueError("MOQ 要在 1 到 10,000,000 之间")
    tiers = {}
    for k, val in _pairs(raw.get("fob_ningbo_usd"), "FOB 价格阶梯").items():
        try:
            price = float(str(val).replace("$", "").replace("USD", "").strip())
        except ValueError:
            raise ValueError(f"价格要填数字：{k}") from None
        if not 0 < price < 100_000:
            raise ValueError(f"价格不合理：{k} = {val}")
        tiers[k] = price
    if not tiers:
        raise ValueError("至少填一档 FOB 价格（例如 500-1999: 9.8），代码用最低一档核对报价")
    not_held = _lines(raw.get("certifications_not_held"), 15, 60, "没有的认证")
    held = _lines(raw.get("certifications_held"), 15, 80, "已有的认证")
    clash = set(map(str.lower, held)) & set(map(str.lower, not_held))
    if clash:
        raise ValueError(f"同一项认证不能既“已有”又“没有”：{', '.join(sorted(clash))}")
    tests = {}
    for name, val in (raw.get("material_tests") or {}).items():
        if name not in MATERIALS:
            raise ValueError(f"材料宣称只认 {', '.join(MATERIALS)}")
        val = _text(val, 120, f"{name} 检测情况")
        if val:
            tests[name] = val
    product = {
        "name_zh": _text(raw.get("name_zh"), 40, "中文名", required=True),
        "name_en": _text(raw.get("name_en"), 80, "英文名", required=True),
        "specs": _pairs(raw.get("specs"), "规格"),
        "certifications_held": held,
        "certifications_not_held": not_held,
        "material_tests": tests,
        "moq_units": moq,
        "fob_ningbo_usd": tiers,
        "packaging": _text(raw.get("packaging"), 80, "包装"),
        "selling_points_zh": _lines(raw.get("selling_points_zh"), 10, 80, "卖点"),
    }
    if factory_id:
        product = {"factory_id": factory_id, **product}
    return product


class CustomProducts:
    """state/custom_products.json: the products a merchant added in the app."""

    def __init__(self, path):
        self.path = Path(path)

    def load(self):
        return json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else []

    def _write(self, items):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")

    def save(self, product, product_id=None):
        """Insert a new card (id MY-001, MY-002 …) or replace the one with product_id."""
        items = self.load()
        ids = [p["id"] for p in items]
        if product_id:
            if product_id not in ids:
                raise ValueError(f"只能编辑自己新增的商品：{product_id}")
            product = {"id": product_id, **product}
            items[ids.index(product_id)] = product
        else:
            n = max([int(i.split("-")[1]) for i in ids if re.match(r"^MY-\d+$", i)] or [0]) + 1
            product = {"id": f"MY-{n:03d}", **product}
            items.append(product)
        self._write(items)
        return product

    def delete(self, product_id):
        items = self.load()
        if product_id not in [p["id"] for p in items]:
            raise ValueError(f"只能删除自己新增的商品：{product_id}")
        self._write([p for p in items if p["id"] != product_id])
