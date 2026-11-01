"""Write the product-card import templates the board offers for download.

    python3 tools/make_product_template.py  ->  static/samples/products-template.csv / .xlsx

Both come from tradedesk/product_import.py, so the columns the importer reads and the template
a merchant fills in cannot drift apart (a test checks the files are up to date).
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tradedesk.product_import import template_csv, template_xlsx  # noqa: E402


def main():
    out = ROOT / "static" / "samples"
    (out / "products-template.csv").write_text(template_csv(), encoding="utf-8")
    (out / "products-template.xlsx").write_bytes(template_xlsx())
    print("wrote static/samples/products-template.csv and products-template.xlsx")


if __name__ == "__main__":
    main()
