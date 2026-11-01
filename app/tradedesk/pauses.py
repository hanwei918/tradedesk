"""Pausing a rule that keeps raising false alarms, with a log of who-did-what-and-why.

A paused rule still goes into every prompt exactly as before (so recorded answers still replay);
only its hits are taken out of the result and shown apart, never counted towards the risk level.
Facts from the product card (certifications, prices, MOQ ...) are not rules and cannot be paused.
"""

import json
import threading
import time
from pathlib import Path


class RulePauses:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()

    def load(self):
        return json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {"paused": {}, "log": []}

    def _write(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    def paused_ids(self):
        return set(self.load()["paused"])

    def set(self, kb, rule_id, paused, reason):
        rule = kb.rules.get(rule_id)
        if not rule or (rule.get("check") or {}).get("kind") in (None, "reference"):
            raise ValueError("只能暂停规则库里参与检查的规则（资料卡上的事实不能暂停）")
        reason = (reason or "").strip() if isinstance(reason, str) else ""
        if len(reason) < 2:
            raise ValueError("写一句原因，例如：业务员连续判为误报")
        with self.lock:
            data = self.load()
            if paused == (rule_id in data["paused"]):
                raise ValueError(f"{rule_id} 已经是{'暂停' if paused else '启用'}状态")
            ts = time.strftime("%Y-%m-%d %H:%M")
            if paused:
                data["paused"][rule_id] = {"ts": ts, "reason": reason[:200]}
            else:
                del data["paused"][rule_id]
            data["log"].append({"ts": ts, "rule_id": rule_id, "action": "暂停" if paused else "恢复", "reason": reason[:200]})
            self._write(data)
            return data


def split_paused(findings, paused):
    """(counted, set aside): a finding is set aside when the rule it cites is paused."""
    if not paused:
        return findings, []
    kept, aside = [], []
    for f in findings:
        (aside if (f.get("source") or {}).get("rule_id") in paused else kept).append(f)
    return kept, aside
