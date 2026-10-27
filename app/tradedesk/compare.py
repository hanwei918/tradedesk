"""Aggregate the comparison experiment: general-purpose AI vs TradeDesk, same checks for every arm."""

from .evaluate import label_of

ARMS = {
    "plain": {"name_zh": "直接用通用 AI", "desc_zh": "把询盘贴进通用 AI，请它帮忙回复（业务员现在的常见做法）"},
    "with_facts": {"name_zh": "通用 AI + 工厂资料", "desc_zh": "同上，再附上工厂/产品资料卡和业务员意图"},
    "tradedesk": {"name_zh": "TradeDesk 第 1 轮", "desc_zh": "TradeDesk 生成的第一版回复，未经人工修改"},
    "tradedesk_fixed": {"name_zh": "TradeDesk 改一轮后", "desc_zh": "业务员点一次“按风险提示全部修改”之后"},
}


def finding_label(f):
    return label_of(f) or (f"模型:{f['source'].get('rule_id')}" if f.get("by") == "model" else f["check"])


def summarize(rows):
    """rows: {arm: [ {inquiry_id, reply, findings, risk, dropped} ]} -> per-arm counts."""
    out = {}
    for arm, items in rows.items():
        reds = [f for it in items for f in it["findings"] if f["severity"] == "red"]
        ambers = [f for it in items for f in it["findings"] if f["severity"] == "amber"]
        by_label = {}
        for f in reds:
            k = finding_label(f)
            by_label[k] = by_label.get(k, 0) + 1
        out[arm] = {
            "replies": len(items),
            "replies_with_red": sum(any(f["severity"] == "red" for f in it["findings"]) for it in items),
            "replies_green": sum(it["risk"] == "green" for it in items),
            "red": len(reds), "amber": len(ambers),
            "red_by_rules": sum(f.get("by") != "model" for f in reds),
            "red_by_model": sum(f.get("by") == "model" for f in reds),
            "dropped": sum(len(it.get("dropped") or []) for it in items),
            "red_by_label": dict(sorted(by_label.items(), key=lambda kv: -kv[1])),
        }
    return out
