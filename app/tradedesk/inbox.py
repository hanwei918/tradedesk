"""Inquiry inbox (priority) and cross-role tasks.

The model only extracts facts from an inquiry, each with a quote from the
inquiry text (see workflows._guard_understanding). The priority score is plain
arithmetic over those quoted facts, so every point of it can be shown and
argued with.
"""

import json
import re
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = ROOT / "state"
TASK_STATUS = ["待处理", "进行中", "已完成"]
ROLES = ["采购", "生产", "美工", "运营", "业务"]


def first_number(text):
    m = re.search(r"\d[\d,，\s]*", text or "")
    if not m:
        return None
    digits = re.sub(r"\D", "", m.group(0))
    return int(digits) if digits else None


def priority(understanding, product):
    """Score 0-100 with a line-by-line breakdown. Base 50."""
    comps = []
    for s in (understanding.get("signals") or [])[:6]:
        comps.append({"label_zh": ("＋ " if s.get("positive") else "－ ") + s.get("signal_zh", ""),
                      "delta": 8 if s.get("positive") else -8, "quote": s.get("quote", "")})
    for c in understanding.get("conflicts") or []:
        red = c.get("severity") == "red"
        comps.append({"label_zh": f"{'硬冲突' if red else '待确认'}：{c.get('topic_zh', '')}",
                      "delta": -6 if red else -3, "quote": c.get("quote", "")})
    moq = product.get("moq_units")
    for r in understanding.get("requests") or []:
        if "数量" in (r.get("topic_zh") or ""):
            qty = first_number(r.get("value"))
            if qty and moq:
                if qty >= 3 * moq:
                    comps.append({"label_zh": f"数量 {qty:,}，是 MOQ 的 3 倍以上", "delta": 15, "quote": r.get("quote", "")})
                elif qty >= moq:
                    comps.append({"label_zh": f"数量 {qty:,}，达到 MOQ {moq:,}", "delta": 8, "quote": r.get("quote", "")})
                else:
                    comps.append({"label_zh": f"数量 {qty:,}，低于 MOQ {moq:,}", "delta": -10, "quote": r.get("quote", "")})
            break
    score = max(0, min(100, 50 + sum(c["delta"] for c in comps)))
    level = "高" if score >= 65 else "中" if score >= 40 else "低"
    return {"score": score, "level": level, "components": comps}


def guard_tasks(tasks, inquiry_text, norm):
    """Keep a task only if its role is known and its quote is really in the inquiry."""
    text = norm(inquiry_text)
    kept, dropped = [], 0
    for t in tasks or []:
        if not isinstance(t, dict):
            dropped += 1
            continue
        q = (t.get("quote") or "").strip()
        if t.get("role_zh") not in ROLES or len(q) < 2 or norm(q) not in text or not t.get("task_zh"):
            dropped += 1
            continue
        kept.append({"role_zh": t["role_zh"], "task_zh": t["task_zh"].strip(), "quote": q,
                     "priority": "high" if t.get("priority") == "high" else "normal"})
    return kept, dropped


class Inbox:
    def __init__(self, state_dir=STATE_DIR):
        self.dir = Path(state_dir)
        self.lock = threading.Lock()

    def _read(self, name, default):
        p = self.dir / name
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default

    def _write(self, name, data):
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / (name + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.dir / name)

    # ---------------------------------------------------------- inbox
    def set_triage(self, inquiry_id, understanding, prio):
        with self.lock:
            data = self._read("inbox.json", {})
            entry = data.setdefault(inquiry_id, {})
            entry.update({"understanding": understanding, "priority": prio,
                          "triaged": time.strftime("%Y-%m-%d %H:%M")})
            self._write("inbox.json", data)

    def set_replied(self, inquiry_id, run_id, rnd, risk):
        with self.lock:
            data = self._read("inbox.json", {})
            data.setdefault(inquiry_id, {})["reply"] = {"run_id": run_id, "round": rnd, "risk": risk,
                                                        "updated": time.strftime("%Y-%m-%d %H:%M")}
            self._write("inbox.json", data)

    def inbox(self):
        return self._read("inbox.json", {})

    # ---------------------------------------------------------- tasks
    def replace_tasks(self, inquiry_id, label_zh, tasks, run_id):
        with self.lock:
            all_tasks = [t for t in self._read("tasks.json", []) if t["inquiry_id"] != inquiry_id]
            for t in tasks:
                all_tasks.append(dict(t, id=uuid.uuid4().hex[:8], inquiry_id=inquiry_id, inquiry_label_zh=label_zh,
                                      run_id=run_id, status="待处理", created=time.strftime("%Y-%m-%d %H:%M")))
            self._write("tasks.json", all_tasks)

    def set_task_status(self, task_id, status):
        if status not in TASK_STATUS:
            raise ValueError(f"状态只能是：{'、'.join(TASK_STATUS)}")
        with self.lock:
            tasks = self._read("tasks.json", [])
            hit = next((t for t in tasks if t["id"] == task_id), None)
            if not hit:
                raise KeyError("找不到这条任务")
            hit["status"] = status
            hit["updated"] = time.strftime("%Y-%m-%d %H:%M")
            self._write("tasks.json", tasks)
            return hit

    def tasks(self):
        return self._read("tasks.json", [])

    def reset(self):
        with self.lock:
            for name in ("inbox.json", "tasks.json"):
                p = self.dir / name
                if p.exists():
                    p.unlink()
