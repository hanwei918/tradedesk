"""Daily digest pushed to a WeCom (企业微信) group robot, and follow-up reminders.

Once a day at the set time the server builds a short summary from what is already on disk: new
inquiries by priority, replies nobody has confirmed, tasks that have sat for days, and buyers who
were sent a reply some days ago and may need a nudge. Building it calls no model. It goes to the
group robot's webhook (official API: markdown, at most 4096 bytes). It carries inquiry titles,
priorities, task lines and counts, never the inquiry text or the reply, because it leaves this computer.

The scheduler tries once a day: a failed push is recorded and shown, not retried every minute.
"""

import json
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

WEBHOOK = re.compile(r"^https://qyapi\.weixin\.qq\.com/cgi-bin/webhook/send\?key=[A-Za-z0-9-]{8,64}$")
MAX_BYTES = 4096          # WeCom markdown limit
TOP = 5                   # lines per section; the rest becomes "还有 N 条"
TASK_STALE_DAYS = 2       # a task untouched this long counts as piling up
FOLLOW_STATUS = ["等回复", "买家已回复", "已关闭"]
DEFAULTS = {"enabled": False, "time": "08:30", "follow_days": 3, "webhook": "", "last": None}


class DigestError(Exception):
    pass


class DigestStore:
    """state/digest.json (settings, webhook, last push) and state/follow.json (follow-up status per inquiry)."""

    def __init__(self, state_dir):
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

    def settings(self):
        return {**DEFAULTS, **self._read("digest.json", {})}

    def public(self):
        """Settings for the page: the webhook key is never sent back whole."""
        s = self.settings()
        key = s["webhook"].split("key=", 1)[1] if s["webhook"] else ""
        return {k: v for k, v in s.items() if k != "webhook"} | {
            "has_webhook": bool(key), "webhook_hint": f"key={key[:4]}…{key[-4:]}" if key else ""}

    def save(self, payload):
        with self.lock:
            s = self.settings()
            if "time" in payload:
                if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(payload["time"])):
                    raise ValueError("发送时间写成 08:30 这样的 24 小时制")
                s["time"] = payload["time"]
            if "follow_days" in payload:
                try:
                    days = int(payload["follow_days"])
                except (TypeError, ValueError):
                    raise ValueError("跟进天数要填整数") from None
                if not 1 <= days <= 30:
                    raise ValueError("跟进天数要在 1 到 30 之间")
                s["follow_days"] = days
            if payload.get("clear_webhook"):
                s["webhook"], s["enabled"] = "", False
            elif (payload.get("webhook") or "").strip():
                url = payload["webhook"].strip()
                if not WEBHOOK.match(url):
                    raise ValueError("只接受企业微信群机器人的 webhook 地址（https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…）")
                s["webhook"] = url
            if "enabled" in payload:
                if payload["enabled"] is True and not s["webhook"]:
                    raise ValueError("先填企业微信群机器人的 webhook 地址，再打开每日推送")
                s["enabled"] = payload["enabled"] is True
            self._write("digest.json", s)
        return self.public()

    def record(self, today, ok, detail):
        with self.lock:
            s = self.settings()
            s["last"] = {"date": today, "ts": time.strftime("%Y-%m-%d %H:%M"), "ok": ok, "detail": str(detail)[:200]}
            self._write("digest.json", s)

    def follow(self):
        return self._read("follow.json", {})

    def set_follow(self, inquiry_id, status):
        if status not in FOLLOW_STATUS:
            raise ValueError("跟进状态只能是：" + "、".join(FOLLOW_STATUS))
        with self.lock:
            data = self.follow()
            data[str(inquiry_id)] = {"status": status, "updated": time.strftime("%Y-%m-%d %H:%M")}
            self._write("follow.json", data)
        return data


def _date(ts):
    return datetime.strptime(ts[:16], "%Y-%m-%d %H:%M")


def follow_ups(inquiries, sent_records, follow, now, days):
    """Buyers sent a reply (as is or edited) at least `days` ago and not marked replied or closed.

    Only replies a salesperson recorded as sent count: a draft that was generated is not a sent email."""
    last_sent = {}
    for e in sent_records:
        if e.get("inquiry_id") and e["outcome"] in ("as_is", "edited"):
            if e["inquiry_id"] not in last_sent or e["ts"] > last_sent[e["inquiry_id"]]["ts"]:
                last_sent[e["inquiry_id"]] = e
    out = []
    for q in inquiries:
        e = last_sent.get(q["id"])
        if not e:
            continue
        status = (follow.get(q["id"]) or {}).get("status", "等回复")
        # a status set after the last send wins; a new send re-opens the wait
        if status != "等回复" and (follow.get(q["id"]) or {}).get("updated", "") >= e["ts"]:
            continue
        waited = (now - _date(e["ts"])).days
        if waited >= days:
            out.append({"inquiry_id": q["id"], "label_zh": q.get("label_zh", q["id"]), "sent": e["ts"], "days": waited,
                        "run_id": e.get("run_id", ""), "product_id": e.get("product_id") or q.get("product_id")})
    return sorted(out, key=lambda x: -x["days"])


def build(kb, inbox_state, tasks, sent_records, follow, now, days):
    """The digest as sections (for the page) and as WeCom markdown (at most MAX_BYTES)."""
    handled = {(e.get("inquiry_id"), e.get("run_id")) for e in sent_records}
    new, pending = [], []
    for q in kb.inquiries:
        st = inbox_state.get(q["id"], {})
        prio = st.get("priority") or {}
        conflicts = [c.get("topic_zh", "") for c in (st.get("understanding") or {}).get("conflicts") or []
                     if c.get("severity") == "red"][:2]
        reply = st.get("reply")
        if not reply:
            new.append({"label_zh": q.get("label_zh", q["id"]), "score": prio.get("score"), "level": prio.get("level"),
                        "conflicts": conflicts})
        elif reply.get("risk") in ("red", "amber") and (q["id"], reply.get("run_id")) not in handled:
            pending.append({"label_zh": q.get("label_zh", q["id"]), "risk": reply["risk"], "round": reply.get("round")})
    new.sort(key=lambda x: -(x["score"] if x["score"] is not None else -1))
    pending.sort(key=lambda x: x["risk"] != "red")
    stale = [t for t in tasks if t.get("status") != "已完成"
             and now - _date(t.get("updated") or t["created"]) >= timedelta(days=TASK_STALE_DAYS)]
    follow_list = follow_ups(kb.inquiries, sent_records, follow, now, days)
    sections = {"new": new, "pending": pending, "stale_tasks": stale, "follow": follow_list}

    head = (f"**TradeDesk 每日摘要 · {now:%Y-%m-%d}**\n"
            f"> 新询盘 {len(new)} 条 · 待确认的回复 {len(pending)} 条 · 该跟进的买家 {len(follow_list)} 位 · "
            f"积压任务 {len(stale)} 条")
    blocks = []

    def block(title, items, line):
        if items:
            rows = [f"{i}. {line(x)}" for i, x in enumerate(items[:TOP], 1)]
            if len(items) > TOP:
                rows.append(f"…还有 {len(items) - TOP} 条，在 TradeDesk 里看")
            blocks.append(f"**{title}**\n" + "\n".join(rows))

    block("该跟进的买家", follow_list, lambda x: f"{x['label_zh']} · 回复已发出 {x['days']} 天")
    block("待确认的回复", pending, lambda x: f"{x['label_zh']} · 第 {x['round']} 轮 · {'不能发' if x['risk'] == 'red' else '需人工确认'}")
    block("新询盘（按优先级）", new, lambda x: x["label_zh"] + (f" · 优先级 {x['level']} {x['score']}" if x["score"] is not None else " · 还没整理")
          + (f" · 对不上：{'、'.join(x['conflicts'])}" if x["conflicts"] else ""))
    short = lambda text, n=40: text if len(text) <= n else text[:n] + "…"
    block(f"积压超过 {TASK_STALE_DAYS} 天的任务", stale, lambda t: f"{t.get('role_zh', '')} · {short(t.get('task_zh', ''))}")
    if not blocks:
        blocks.append("今天没有待办。")
    text = head
    for b in blocks + ["在电脑上打开 TradeDesk 处理；摘要只有标题、优先级和待办，不含询盘原文和回复。"]:
        candidate = text + "\n\n" + b
        if len(candidate.encode("utf-8")) > MAX_BYTES - 64:
            text += "\n\n…内容太长，其余在 TradeDesk 里看"
            break
        text = candidate
    return {"sections": sections, "markdown": text, "bytes": len(text.encode("utf-8"))}


def send(webhook, markdown, transport=None):
    """POST to the group robot. Raises DigestError with WeCom's own message when it refuses."""
    if not WEBHOOK.match(webhook or ""):
        raise DigestError("还没填企业微信群机器人的 webhook 地址")
    body = json.dumps({"msgtype": "markdown", "markdown": {"content": markdown}}, ensure_ascii=False).encode("utf-8")
    if transport:
        reply = transport(webhook, body)
    else:
        req = urllib.request.Request(webhook, data=body, method="POST", headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                reply = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            raise DigestError(f"连不上企业微信：{exc}") from None
    if reply.get("errcode") != 0:
        raise DigestError(f"企业微信拒绝了：{reply.get('errcode')} {reply.get('errmsg', '')}".strip())
    return reply


def due(settings, now):
    """True once a day, at or after the set time, when the push is on and has not been tried today."""
    if not settings.get("enabled") or not settings.get("webhook"):
        return False
    if (settings.get("last") or {}).get("date") == f"{now:%Y-%m-%d}":
        return False
    return f"{now:%H:%M}" >= settings["time"]
