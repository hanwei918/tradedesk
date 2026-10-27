"""Run the fixed demo inputs against the real model and cache every answer.

    TRADEDESK_MODE=record python3 tools/record_demo.py

Afterwards `TRADEDESK_MODE=replay python3 server.py` replays the same demo with
no network, as long as the presenter clicks the same buttons with the same
inputs (the cache key is the exact request). Results are also written to
docs/demo-runs/ so the documents can quote real output.
"""

import base64
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("TRADEDESK_MODE", "record")

from tradedesk.kb import KnowledgeBase  # noqa: E402
from tradedesk.llm import LLM  # noqa: E402
from tradedesk.workflows import Runner  # noqa: E402

OUT = ROOT.parent / "docs" / "demo-runs"
FIX_ALL = "按风险提示全部修改"


def fix_instruction(findings):
    # Same text the web page sends for the "按风险提示全部修改" chip (app.js).
    return FIX_ALL + "\n风险提示：\n" + "\n".join(
        f"{i + 1}. {f['problem_zh']}（原文：{f['quote']}）建议：{f['suggestion_zh']}" for i, f in enumerate(findings))


def fix_listing_instruction(platforms):
    return FIX_ALL + "\n风险提示：\n" + "\n".join(
        f"[{pl}] {f['field']}：{f['problem_zh']}（原文：{f['quote']}）建议：{f['suggestion_zh']}"
        for pl, d in platforms.items() for f in d["findings"])


def save(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def summary(label, r):
    print(f"{label}: risk={r['risk']} findings={len(r['findings'])} dropped={len(r['dropped'])}")


def main():
    kb = KnowledgeBase()
    runner = Runner(LLM(), kb)
    runner.board.reset()
    runner.inbox.reset()
    print(runner.llm.describe())
    tri = runner.triage({})
    for t in tri["triaged"]:
        print(f"triage {t['inquiry_id']}: {t['priority']['score']} {t['priority']['level']}")
    for q in kb.inquiries:
        base = {"inquiry_text": q["text"], "intent_zh": q["intent_zh"], "product_id": q["product_id"],
                "inquiry_id": q["id"]}
        r1 = runner.inquiry(dict(base, round=1))
        summary(f"{q['id']} round 1", r1)
        save(f"{q['id']}-round1", r1)
        if r1["findings"]:
            r2 = runner.inquiry(dict(base, understanding=r1["understanding"], language=r1["language"],
                                     previous={"reply": r1["reply"], "internal_brief_zh": r1["internal_brief_zh"]},
                                     instruction_zh=fix_instruction(r1["findings"]), round=2))
            summary(f"{q['id']} round 2", r2)
            save(f"{q['id']}-round2", r2)
    for pid in kb.products:
        r1 = runner.listing({"product_id": pid, "platforms": ["amazon_us", "tiktok_mx"], "round": 1})
        for pl, d in r1["platforms"].items():
            summary(f"{pid} {pl} round 1", d)
        save(f"listing-{pid}-round1", r1)
        if any(d["findings"] for d in r1["platforms"].values()):
            prev = {pl: {"content": d["content"]} for pl, d in r1["platforms"].items()}
            r2 = runner.listing({"product_id": pid, "platforms": list(prev), "previous": prev,
                                 "instruction_zh": fix_listing_instruction(r1["platforms"]), "round": 2})
            for pl, d in r2["platforms"].items():
                summary(f"{pid} {pl} round 2", d)
            save(f"listing-{pid}-round2", r2)
    sample = "BEST SELLER!! [Brand] 1.7L Electric Kettle, BPA Free, UL Listed, Free Shipping"
    r = runner.check_text({"platform": "amazon_us", "product_id": "KET-17S", "text": sample})
    summary("paste check", r)
    save("paste-check", r)

    # Main images: the compliant kettle first, then the bad one, so the board ends on the red case.
    samples = ROOT / "static" / "samples"
    for pid, name in [("KET-17S", "KET-17S_main.png"), ("KET-17S", "KET-17S_bad.png"),
                      ("AF-45D", "AF-45D_main.png"), ("BL-35P", "BL-35P_main.png")]:
        url = "data:image/png;base64," + base64.b64encode((samples / name).read_bytes()).decode()
        r = runner.image_check({"product_id": pid, "image": url, "name": name})
        summary(f"image {name}", r)
        save(f"image-{name[:-4]}", r)

    # Move a few tasks along so the task board shows every column.
    tasks = runner.inbox.tasks()
    for t, status in zip(tasks[:3], ["进行中", "已完成", "进行中"]):
        runner.inbox.set_task_status(t["id"], status)
    print(f"tasks: {len(tasks)}")

    # A green cell marked as listed, so the board shows every status.
    for pid in kb.products:
        cell = runner.board.snapshot([pid])[0]["cells"]["tiktok_mx"]
        if cell.get("risk") == "green":
            runner.board.mark_listed(pid, "tiktok_mx")
            print(f"marked {pid} tiktok_mx as listed")
            break


if __name__ == "__main__":
    main()
