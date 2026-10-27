"""Main-image checks.

Pixel facts (size, white background, how much of the frame the product fills,
whether it touches the edge) are measured by code. Only things that need
looking at the picture (text, badges, props, realism) go to the model, and a
model finding is kept only if it names one of the vision rules it was given.

Pillow is optional: without it the pixel checks are reported as not run.
"""

import base64
import io
import re

try:
    from PIL import Image
except ImportError:  # pragma: no cover - depends on the machine
    Image = None

from .checks import finding, kb_source

DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|jpg|webp|gif));base64,(.+)$", re.S)
WHITE = 250        # a pixel counts as white when every channel is >= this
INK = 245          # a pixel counts as product when any channel is < this


def parse_data_url(data_url):
    m = DATA_URL.match(data_url or "")
    if not m:
        raise ValueError("图片必须是 PNG/JPEG/WebP 的 data URL")
    media = m.group(1).replace("jpg", "jpeg")
    raw = base64.b64decode(m.group(2))
    return media, raw, m.group(2)


def measure(raw):
    """Return pixel metrics, or None when Pillow is not installed."""
    if Image is None:
        return None
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = im.size
    longest = max(w, h)
    small = im.copy()
    small.thumbnail((400, 400))
    sw, sh = small.size
    px = small.load()
    band = max(1, round(min(sw, sh) * 0.02))
    border, white_border = 0, 0
    exact_border = 0
    min_x, min_y, max_x, max_y = sw, sh, -1, -1
    for y in range(sh):
        for x in range(sw):
            r, g, b = px[x, y]
            on_border = x < band or y < band or x >= sw - band or y >= sh - band
            if on_border:
                border += 1
                if r >= WHITE and g >= WHITE and b >= WHITE:
                    white_border += 1
                if (r, g, b) == (255, 255, 255):
                    exact_border += 1
            if r < INK or g < INK or b < INK:
                min_x, min_y = min(min_x, x), min(min_y, y)
                max_x, max_y = max(max_x, x), max(max_y, y)
    if max_x < 0:
        fill, bbox, touches = 0.0, None, False
    else:
        bw, bh = max_x - min_x + 1, max_y - min_y + 1
        fill = max(bw / sw, bh / sh)
        bbox = [min_x / sw, min_y / sh, bw / sw, bh / sh]
        touches = min_x == 0 or min_y == 0 or max_x == sw - 1 or max_y == sh - 1
    return {"width": w, "height": h, "longest_side": longest,
            "white_border": round(white_border / border, 4),
            "exact_white_border": round(exact_border / border, 4),
            "fill": round(fill, 3), "bbox": bbox, "touches_edge": touches}


def pixel_findings(metrics, rules):
    """Fill and edge estimates assume a white background, so they only run when the background passes."""
    out = []
    white_rule = next((r for r in rules if r["check"].get("metric") == "white_border"), None)
    white_ok = white_rule is None or metrics["white_border"] >= white_rule["check"]["min"]
    metrics["background_ok"] = white_ok
    for rule in rules:
        if not white_ok and rule["check"].get("metric") in ("fill", "not_cropped"):
            continue
        spec = rule["check"]
        metric = spec.get("metric")
        sev = spec.get("severity", "amber")
        if metric == "longest_side" and metrics["longest_side"] < spec["min"]:
            out.append(finding("image_size", sev, "image", "",
                               f"最长边 {metrics['longest_side']} 像素，低于 {spec['min']}",
                               "用更高分辨率的原图重新导出", kb_source(rule)))
        elif metric == "white_border" and metrics["white_border"] < spec["min"]:
            out.append(finding("image_background", sev, "image", "",
                               f"四周边缘只有 {metrics['white_border']:.0%} 是白色（纯 255 白 {metrics['exact_white_border']:.0%}），不是纯白背景",
                               "抠图后放到 RGB 255,255,255 的纯白背景上", kb_source(rule)))
        elif metric == "fill" and metrics["fill"] < spec["min"]:
            out.append(finding("image_fill", sev, "image", "",
                               f"产品约占画面 {metrics['fill']:.0%}（按非白色区域外接框估算），低于 85%",
                               "裁剪留白，让产品占满约 85% 的画面", kb_source(rule)))
        elif metric == "not_cropped" and metrics["touches_edge"]:
            out.append(finding("image_cropped", sev, "image", "",
                               "非白色区域贴到了图片边缘，产品可能被裁掉了一部分",
                               "四周留出少量白边，确保产品完整", kb_source(rule)))
    return out


def guard_vision_findings(raw, allowed_rules):
    """Keep a vision finding only if it names an offered rule and says what it saw."""
    allowed = {r["id"]: r for r in allowed_rules}
    kept, dropped = [], []
    for item in raw or []:
        if not isinstance(item, dict):
            dropped.append({"reason_zh": "格式不对", "item": item})
            continue
        rule = allowed.get(item.get("rule_id"))
        seen = (item.get("evidence_zh") or "").strip()
        if not rule:
            dropped.append({"reason_zh": "引用了不存在或未提供的规则编号", "item": item})
            continue
        if len(seen) < 2:
            dropped.append({"reason_zh": "没有说明在图里看到了什么", "item": item})
            continue
        severity = item.get("severity") if item.get("severity") in ("red", "amber") else "amber"
        f = finding("vision_review", severity, "image", "", item.get("problem_zh") or rule.get("title_zh"),
                    item.get("suggestion_zh") or "", kb_source(rule), by="model")
        f["evidence_zh"] = seen
        kept.append(f)
    return kept, dropped
