"""Inquiry reply -> listing hand-off.

After replying to a buyer who also sells online, the factory attaches listing copy
written from the same product card. This module checks, by code only, that the two
texts do not contradict each other or the card: a certification the reply honestly
denies must not appear as a claim in the listing, and vice versa.
"""

import re

from . import checks

CAPACITY = re.compile(r"(?i)(\d+(?:\.\d+)?)\s?(ml|mL|l|liters?|litres?|litros?)\b")
VOLTAGE = re.compile(r"(?<![\d.])(\d{3})\s?V\b")


def _card_capacity_ml(specs):
    if specs.get("capacity_ml"):
        return float(specs["capacity_ml"])
    if specs.get("capacity_l"):
        return float(specs["capacity_l"]) * 1000
    return None


def _capacities_ml(text):
    out = set()
    for num, unit in CAPACITY.findall(text or ""):
        value = float(num) * (1 if unit.lower() == "ml" else 1000)
        if 50 <= value <= 20000:  # ignore "2 L of water per day"-style noise outside product sizes
            out.add(round(value))
    return out


def _cert_status(text, product, cert):
    one = dict(product, certifications_not_held=[cert])
    found = checks.check_certifications({"t": text}, one)
    if any(f["severity"] == "red" for f in found):
        return "写成有"
    if found:
        return "承诺办理"
    pattern = checks.CERT_PATTERNS.get(cert)
    return "如实说没有" if pattern and re.search(pattern, text or "") else "没提"


def _material_status(text, product, kb, name):
    one = dict(product, material_tests={name: product["material_tests"][name]})
    found = [f for f in checks.check_material_claims({"t": text}, one, kb) if name.lower() in f["quote"].lower()]
    if any(f["severity"] == "red" for f in found):
        return "宣称无检测的"
    if found:
        return "引用供应商声明"
    return "没宣称"


def consistency(reply, listing_fields, product, kb):
    """Rows of facts from the product card, with what the reply and the listing say about each."""
    texts = {"reply": reply or "", "listing": "\n".join(v for v in (listing_fields or {}).values() if isinstance(v, str))}
    rows = []
    for cert in product.get("certifications_held", []):
        key = re.escape(cert.split(" ")[0])
        said = {k: "提到" if re.search(rf"(?<![A-Za-z]){key}(?![A-Za-z])", t) else "没提" for k, t in texts.items()}
        rows.append({"kind_zh": "持有的认证", "fact": cert, "card": "持有", **said, "ok": True})
    for cert in product.get("certifications_not_held", []):
        said = {k: _cert_status(t, product, cert) for k, t in texts.items()}
        rows.append({"kind_zh": "没有的认证", "fact": cert, "card": "未持有", **said,
                     "ok": all(v in ("如实说没有", "没提") for v in said.values())})
    claimable = {name for name, _ in checks.MATERIAL_CLAIMS}  # "BPA free" is a claim; "LFGB: not tested" is not
    for name, value in (product.get("material_tests") or {}).items():
        if name not in claimable:
            continue
        said = {k: _material_status(t, product, kb, name) for k, t in texts.items()}
        rows.append({"kind_zh": "没有检测报告的宣称", "fact": f"{name} free", "card": value, **said,
                     "ok": all(v != "宣称无检测的" for v in said.values())})
    specs = product.get("specs") or {}
    card_ml = _card_capacity_ml(specs)
    if card_ml:
        said, ok = {}, True
        for k, t in texts.items():
            found = _capacities_ml(t)
            wrong = sorted(v for v in found if abs(v - card_ml) > 1)
            said[k] = ("写成 " + " / ".join(f"{v:g} ml" for v in wrong)) if wrong else ("一致" if found else "没提")
            ok = ok and not wrong
        card = f"{specs['capacity_l']:g} L" if specs.get("capacity_l") else f"{card_ml:g} ml"
        rows.append({"kind_zh": "规格", "fact": "容量", "card": card, **said, "ok": ok})
    voltage = specs.get("voltage_us")
    if voltage:
        card_v = VOLTAGE.search(voltage).group(1)
        said, ok = {}, True
        for k, t in texts.items():
            found = set(VOLTAGE.findall(t))
            wrong = sorted(found - {card_v})
            said[k] = ("写成 " + " / ".join(f"{v}V" for v in wrong)) if wrong else ("一致" if found else "没提")
            ok = ok and not wrong
        rows.append({"kind_zh": "规格", "fact": "美国电压", "card": voltage, **said, "ok": ok})
    return {"product_id": product["id"], "rows": rows, "conflicts": sum(not r["ok"] for r in rows)}
