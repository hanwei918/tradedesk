"""Measure the code-rule layer against labelled cases.

Only the deterministic layer is measured here (no model calls), so the numbers
are exactly reproducible. Two sets are kept apart:
- dev.json      written while building the checker (includes the false
                positives found in real recordings) — expect it to look good;
- heldout.json  written blind by someone who never saw the checker code; its
                first result is frozen in heldout_first_run.json because three
                defects it found were then fixed;
- heldout2.json a second blind set written after those fixes.
"""

import json
from pathlib import Path

from . import checks

ROOT = Path(__file__).resolve().parent.parent
EVAL_DIR = ROOT / "eval"

CHECK_LABEL = {
    ("fact_cert", "red"): "CERT", ("fact_cert", "amber"): "CERT_OFFER",
    ("fact_material", "red"): "MATERIAL", ("fact_material", "amber"): "MATERIAL_DECL", "fact_price": "PRICE", "fact_moq": "MOQ",
    "fact_lead": "LEAD", ("fact_payment", "red"): "PAYMENT", ("fact_payment", "amber"): "PAYMENT_LATER", "contract_incoterm": "FOB_AIR",
}
LABEL_ZH = {
    "CERT": "声称具备未持有的认证", "CERT_OFFER": "承诺办理认证", "MATERIAL": "无依据的材料宣称", "MATERIAL_DECL": "引用供应商声明（需确认）",
    "PAYMENT_LATER": "提到以后可谈赊账（需确认）", "PRICE": "报价低于底价", "MOQ": "起订量低于 MOQ", "LEAD": "交期短于标准", "PAYMENT": "接受货到后付款",
    "FOB_AIR": "FOB 用于空运",
}


def label_of(f):
    if f["check"] in ("kb_regex", "kb_length"):
        return f["source"]["rule_id"]
    return CHECK_LABEL.get((f["check"], f["severity"])) or CHECK_LABEL.get(f["check"])


def run_case(case, kb):
    product = kb.product(case["product_id"])
    findings = checks.run_rule_checks(case["fields"], product, kb, case["platform"])
    got = sorted({label_of(f) for f in findings if label_of(f)})
    want = sorted(set(case.get("expected") or []))
    return {"id": case["id"], "platform": case["platform"], "product_id": case["product_id"],
            "fields": case["fields"], "why_zh": case.get("why_zh", ""),
            "expected": want, "got": got,
            "missed": sorted(set(want) - set(got)), "false_alarm": sorted(set(got) - set(want)),
            "pass": set(got) == set(want),
            "findings": [{"label": label_of(f), "quote": f["quote"], "problem_zh": f["problem_zh"]} for f in findings]}


def score(results):
    tp = sum(len(set(r["expected"]) & set(r["got"])) for r in results)
    fp = sum(len(r["false_alarm"]) for r in results)
    fn = sum(len(r["missed"]) for r in results)
    clean = [r for r in results if not r["expected"]]
    return {"cases": len(results), "passed": sum(r["pass"] for r in results),
            "tp": tp, "fp": fp, "fn": fn,
            "precision": round(tp / (tp + fp), 3) if tp + fp else None,
            "recall": round(tp / (tp + fn), 3) if tp + fn else None,
            "clean_cases": len(clean), "clean_flagged": sum(bool(r["got"]) for r in clean)}


def evaluate(kb, eval_dir=EVAL_DIR):
    out = {}
    for name in ("dev", "heldout", "heldout2"):
        path = Path(eval_dir) / f"{name}.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        results = [run_case(c, kb) for c in data["cases"]]
        out[name] = {"note": data.get("note", ""), "summary": score(results), "results": results}
    first_runs = {}
    for name in ("heldout", "heldout2"):
        p = Path(eval_dir) / f"{name}_first_run.json"
        if p.exists():
            first_runs[name] = json.loads(p.read_text(encoding="utf-8"))
    return {"sets": out, "labels_zh": LABEL_ZH, "first_runs": first_runs,
            "known_limits_zh": ["K16：“we can start at 500 pcs”这类不带 MOQ 关键词的起订量承诺，代码规则抓不到，要靠语义判断；"
                                "我们没有为它硬加正则，以免误伤其他句子。"]}
