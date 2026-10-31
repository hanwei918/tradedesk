"""Import inquiries from a CSV file into the inbox.

Any inquiry list that can be saved as CSV works, as long as one column holds the
inquiry text. Column names are matched loosely (English or Chinese). Imported rows
are kept in state/imported_inquiries.json and shown in the inbox next to the samples;
they are new text, so understanding and replying to them needs live mode.
"""

import csv
import io
import json
import re
from pathlib import Path

from .checks import norm

MAX_ROWS = 200
MAX_TEXT = 4000
COLUMNS = {
    "text": ["text", "inquiry", "message", "content", "body", "询盘内容", "询盘", "内容", "正文", "留言"],
    "buyer": ["buyer", "name", "contact", "company", "买家", "客户", "联系人", "公司"],
    "country": ["country", "region", "国家", "地区"],
    "product": ["product", "product_id", "sku", "model", "产品", "型号", "商品"],
    "subject": ["subject", "title", "主题", "标题"],
}


def _column(header, names):
    for i, h in enumerate(header):
        key = re.sub(r"[\s_]+", "", (h or "").strip().lower().lstrip("﻿"))
        if any(key == re.sub(r"[\s_]+", "", n.lower()) for n in names):
            return i
    return None


def guess_language(text):
    if re.search(r"[぀-ヿ]", text):
        return "ja"
    if re.search(r"[Ѐ-ӿ]", text):
        return "ru"
    if re.search(r"[äöüß]|\b(und|wir|bitte|Angebot)\b", text, re.I):
        return "de"
    if re.search(r"[ñ¿¡]|\b(hola|precio|cotizaci[oó]n|necesitamos|somos|gracias)\b", text, re.I):
        return "es"
    return "en"


def match_product(value, products):
    v = (value or "").strip().lower()
    if not v:
        return None
    for p in products.values():
        if v == p["id"].lower() or v in p["name_en"].lower() or v in p["name_zh"] or p["name_zh"] in v:
            return p["id"]
    return None


def parse(raw, products, default_product=None, existing=()):
    """(rows, skipped). rows are inquiry records; skipped lists (line, reason_zh)."""
    if len(raw) > 1_000_000:
        raise ValueError("文件太大（上限 1 MB）")
    sample = raw[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = list(csv.reader(io.StringIO(raw.lstrip("﻿")), dialect))
    if not reader:
        raise ValueError("文件是空的")
    header, body = reader[0], reader[1:]
    cols = {k: _column(header, names) for k, names in COLUMNS.items()}
    if cols["text"] is None:
        raise ValueError("找不到询盘内容这一列（列名写 text、message、询盘内容 之一）")
    if default_product and default_product not in products:
        raise ValueError(f"未知产品：{default_product}")
    seen = {norm(t) for t in existing}
    rows, skipped = [], []
    for line, rec in enumerate(body, start=2):
        get = lambda k: rec[cols[k]].strip() if cols[k] is not None and cols[k] < len(rec) else ""
        text = get("text")
        if not text:
            skipped.append((line, "询盘内容是空的"))
            continue
        if len(text) > MAX_TEXT:
            skipped.append((line, f"询盘内容超过 {MAX_TEXT} 字"))
            continue
        if norm(text) in seen:
            skipped.append((line, "和已有询盘重复"))
            continue
        product = match_product(get("product"), products) or default_product
        if not product:
            skipped.append((line, "不知道是哪个产品：加一列 product，或导入时选默认产品"))
            continue
        if len(rows) >= MAX_ROWS:
            skipped.append((line, f"一次最多导入 {MAX_ROWS} 条"))
            continue
        seen.add(norm(text))
        language = guess_language(text)
        who = get("buyer") or "买家"
        rows.append({"label_zh": " · ".join(x for x in ["导入", who, get("country") or language.upper(), get("subject")] if x),
                     "platform": "alibaba_rfq", "language": language, "product_id": product, "text": text,
                     "intent_zh": "", "imported": True})
    return rows, skipped


class ImportStore:
    def __init__(self, path):
        self.path = Path(path)

    def load(self):
        return json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else []

    def add(self, rows):
        current = self.load()
        start = max([int(r["id"].split("-")[1]) for r in current] or [0]) + 1
        for i, r in enumerate(rows):
            r["id"] = f"IMP-{start + i:03d}"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(current + rows, ensure_ascii=False, indent=1), encoding="utf-8")
        return rows

    def clear(self):
        if self.path.exists():
            self.path.unlink()
