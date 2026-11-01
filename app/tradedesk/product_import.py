"""Import product cards from the merchant's own spreadsheet (导入资料卡).

One row per product, in the columns of static/samples/products-template.csv / .xlsx. A file saved
from Excel as .xlsx, as UTF-8 CSV or as the GBK CSV Windows Excel writes by default all work. Every
row goes through the same validate() as the form, so a row is either a valid card or a message
that says what to fix; nothing is saved until the merchant confirms the preview.
"""

import base64
import binascii
import csv
import io
import re
import zipfile
import xml.etree.ElementTree as ET

from .catalog_edit import MATERIALS, validate

MAX_BYTES = 2_000_000
MAX_ROWS = 200
MAX_XML = 20_000_000  # uncompressed size of one part of the .xlsx

# column key -> (template header, accepted header names, example)
COLUMNS = {
    "name_zh": ("中文名", ["中文名", "产品名称", "品名", "name_zh"], "示例：1.7L 不锈钢电热水壶"),
    "name_en": ("英文名", ["英文名", "英文品名", "name_en"], "1.7L Stainless Steel Electric Kettle"),
    "moq_units": ("MOQ", ["MOQ", "起订量", "最小起订量", "moq_units"], "500"),
    "fob_ningbo_usd": ("FOB 价格阶梯", ["FOB 价格阶梯", "FOB价格阶梯", "价格阶梯", "FOB", "fob_ningbo_usd"],
                       "500-1999: 9.8; 2000-4999: 9.2"),
    "certifications_held": ("已有认证", ["已有认证", "认证", "certifications_held"], "CB; CE"),
    "certifications_not_held": ("没有的认证", ["没有的认证", "未有认证", "certifications_not_held"], "UL; ETL"),
    "specs": ("规格", ["规格", "参数", "specs"], "容量: 1.7L; 电压: 220-240V"),
    "packaging": ("包装", ["包装", "packaging"], "彩盒，每箱 6 台"),
    "selling_points_zh": ("卖点", ["卖点", "selling_points_zh"], "304 不锈钢内胆; 防干烧"),
    # Filled in = there is NO finished-product test report, so "BPA-free" etc. must not be claimed (same as the form).
    # Only this exact header is accepted: a column called just "BPA 检测" could hold "有报告" and be read backwards.
    **{f"test_{m}": (f"{m} 无检测报告", [f"{m} 无检测报告", f"{m}无检测报告"], "只有原料供应商声明" if m == "BPA" else "")
       for m in MATERIALS},
}
TEMPLATE_HEADER = [spec[0] for spec in COLUMNS.values()]
TEMPLATE_EXAMPLE = [spec[2] for spec in COLUMNS.values()]
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _key(h):
    return re.sub(r"[\s_]+", "", str(h or "").strip().lower().lstrip("﻿"))


def decode_file(b64):
    try:
        raw = base64.b64decode(b64 or "", validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("文件没有读出来，请重新选择") from None
    if not raw:
        raise ValueError("文件是空的")
    if len(raw) > MAX_BYTES:
        raise ValueError("文件太大（最多 2 MB），一次导入 200 个商品以内")
    return raw


def _xml(z, name):
    info = z.getinfo(name)
    if info.file_size > MAX_XML:
        raise ValueError("表格太大，拆成几个文件再导入")
    data = z.read(name)
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise ValueError("表格格式不对（含有不允许的 XML 声明）")
    return ET.fromstring(data)


def _col_index(ref):
    letters = re.match(r"[A-Z]+", ref or "A").group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def xlsx_rows(raw):
    """Rows of the first worksheet as lists of strings (shared strings, inline strings and numbers)."""
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise ValueError("这不是一个能打开的 .xlsx 文件") from None
    names = set(z.namelist())
    shared = []
    if "xl/sharedStrings.xml" in names:
        shared = ["".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t"))
                  for si in _xml(z, "xl/sharedStrings.xml").findall("m:si", NS)]
    sheets = sorted(n for n in names if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
    if not sheets:
        raise ValueError("表格里没有工作表")
    rows = []
    for row in _xml(z, sheets[0]).iter(f"{{{NS['m']}}}row"):
        cells = {}
        for c in row.findall("m:c", NS):
            t, v = c.get("t"), c.find("m:v", NS)
            if t == "s" and v is not None:
                text = shared[int(v.text)] if v.text and int(v.text) < len(shared) else ""
            elif t == "inlineStr":
                text = "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
            else:
                text = v.text if v is not None and v.text is not None else ""
                if re.fullmatch(r"-?\d+\.0", text):
                    text = text[:-2]
            cells[_col_index(c.get("r"))] = text
        rows.append([cells.get(i, "") for i in range(max(cells) + 1)] if cells else [])
        if len(rows) > MAX_ROWS + 1:
            raise ValueError(f"一次最多导入 {MAX_ROWS} 个商品")
    return rows


def csv_rows(raw):
    for enc in ("utf-8-sig", "gb18030"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError("CSV 的编码认不出来：在 Excel 里另存为“CSV UTF-8”再试")
    sample = text[:2000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return list(csv.reader(io.StringIO(text), dialect))


def _semi_lines(value):
    """'a: 1; b: 2' (one spreadsheet cell) -> 'a: 1\\nb: 2', the form's one-per-line format."""
    return "\n".join(x.strip() for x in re.split(r"[;；\n]+", str(value or "")) if x.strip())


def parse(b64, kb):
    """[{line, product | error}] for every non-empty row; raises ValueError if the file itself is unusable."""
    raw = decode_file(b64)
    rows = xlsx_rows(raw) if raw[:2] == b"PK" else csv_rows(raw)
    rows = [r for r in rows if any(str(c).strip() for c in r)]
    if not rows:
        raise ValueError("表格里没有内容")
    header = [_key(h) for h in rows[0]]
    index = {}
    for key, (_, names, _) in COLUMNS.items():
        for n in names:
            if _key(n) in header:
                index[key] = header.index(_key(n))
                break
    missing = [COLUMNS[k][0] for k in ("name_zh", "name_en", "moq_units", "fob_ningbo_usd") if k not in index]
    if missing:
        raise ValueError(f"第一行要是列名，缺少：{'、'.join(missing)}（可以下载模板对照）")
    body = rows[1:]
    if len(body) > MAX_ROWS:
        raise ValueError(f"一次最多导入 {MAX_ROWS} 个商品")
    existing = {(p.get("name_zh"), p.get("name_en")) for p in kb.products.values()}
    out, seen = [], set()
    for n, row in enumerate(body, start=2):
        cell = lambda k: (row[index[k]] if k in index and index[k] < len(row) else "").strip()
        if cell("name_zh").startswith("示例："):
            continue  # the template's example row
        form = {
            "name_zh": cell("name_zh"), "name_en": cell("name_en"), "moq_units": cell("moq_units"),
            "fob_ningbo_usd": _semi_lines(cell("fob_ningbo_usd")), "specs": _semi_lines(cell("specs")),
            "certifications_held": cell("certifications_held"), "certifications_not_held": cell("certifications_not_held"),
            "packaging": cell("packaging"), "selling_points_zh": cell("selling_points_zh"),
            "material_tests": {m: cell(f"test_{m}") for m in MATERIALS if cell(f"test_{m}")},
        }
        try:
            product = validate(form, kb)
        except ValueError as exc:
            out.append({"line": n, "name": form["name_zh"] or "（没有中文名）", "error": str(exc)})
            continue
        key = (product["name_zh"], product["name_en"])
        if key in existing or key in seen:
            out.append({"line": n, "name": product["name_zh"], "error": "已经有同名的商品，跳过"})
            continue
        seen.add(key)
        out.append({"line": n, "name": product["name_zh"], "product": product})
    return out


def template_csv():
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(TEMPLATE_HEADER)
    w.writerow(TEMPLATE_EXAMPLE)
    return "﻿" + buf.getvalue()


def template_xlsx():
    """A minimal .xlsx (inline strings, one sheet) with the same header and example row as the CSV."""
    def esc(s):
        return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def row(r, values):
        cells = "".join(f'<c r="{chr(65 + i)}{r}" t="inlineStr"><is><t>{esc(v)}</t></is></c>' for i, v in enumerate(values))
        return f'<row r="{r}">{cells}</row>'

    sheet = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             f'<worksheet xmlns="{NS["m"]}"><cols><col min="1" max="{len(TEMPLATE_HEADER)}" width="24" customWidth="1"/></cols>'
             f'<sheetData>{row(1, TEMPLATE_HEADER)}{row(2, TEMPLATE_EXAMPLE)}</sheetData></worksheet>')
    parts = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '</Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>',
        "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<workbook xmlns="{NS["m"]}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="资料卡" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '</Relationships>',
        "xl/worksheets/sheet1.xml": sheet,
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(zipfile.ZipInfo(name, date_time=(2026, 11, 1, 0, 0, 0)), data)  # fixed date: same bytes every run
    return buf.getvalue()
