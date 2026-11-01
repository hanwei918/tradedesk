"""Savings estimate: what TradeDesk replaces, and how much that is worth for one factory.

Two kinds of numbers are kept apart, and the page labels them differently:

- measured: read from files in the repository, never typed in. Model cost per inquiry comes from
  eval/cost_run.json (recorded token usage x official price); model cost per listing from the token
  usage stored in cache/; the latency of one live run from docs/demo-runs/.
- assumptions: example values a factory replaces with its own (inquiries per day, minutes per reply,
  wage ...). Nobody measured them; the time a salesperson saves has not been measured at all.
"""

import json
import time
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
COST_RUN = ROOT / "eval" / "cost_run.json"
CACHE = ROOT / "cache"
LIVE_RUN = ROOT.parent / "docs" / "demo-runs" / "live-gpt-5.5-INQ-US-01.json"

# key -> (label, unit, example value, upper bound). Example values, not measurements.
ASSUMPTIONS = {
    "inquiries_per_day": ("每天要回的询盘", "条", 20, 1000),
    "workdays_per_month": ("每月工作日", "天", 22, 31),
    "manual_minutes_per_reply": ("人工回一条询盘（查资料、核对、写英 / 西语回复）", "分钟", 20, 600),
    "review_minutes_per_reply": ("用 TradeDesk 后人工复核一条", "分钟", 5, 600),
    "hourly_wage_cny": ("业务员时薪", "元 / 小时", 45, 10000),
    "listings_per_month": ("每月上新（每个产品出 Amazon + TikTok 两份文案）", "个", 10, 10000),
    "outsourcing_cny_per_listing": ("外包翻译 / 本地化一个产品的文案", "元", 300, 100000),
    "usd_to_cny": ("美元汇率", "", 7.2, 100),
}
REPLACES = [
    "业务员查工厂资料、核对认证和交期、写英 / 西语回复的时间",
    "英文 Listing 和西语种草脚本的外包翻译与本地化",
    "发出前对照平台规则的人工自查",
]
NOT_REPLACED = "发出前的人工确认：红色和黄色提示必须有人看过，系统不会自动发送。"
UNMEASURED = "人工节省的时间没有实测过，需要在工厂试用时用真实询盘验证；上面的假设都可以改。"

# Generation prompts start with these words; one listing = Amazon + TikTok generation + one review each.
AMAZON_PROMPT, TIKTOK_PROMPT, REVIEW_PROMPT = "你是熟悉 Amazon US", "你是做 TikTok Shop", "你是外贸合规审核员"


def _usd(usage, price):
    return (usage["input_tokens"] * price["input"] + usage["output_tokens"] * price["output"]) / 1_000_000


def measured(cost_run=COST_RUN, cache=CACHE, live_run=LIVE_RUN):
    run = json.loads(Path(cost_run).read_text(encoding="utf-8"))
    model, price = next(iter(run["prices_usd_per_mtok"].items()))
    per_prompt = {AMAZON_PROMPT: [], TIKTOK_PROMPT: [], REVIEW_PROMPT: []}
    for f in sorted(Path(cache).glob("*.json")):
        entry = json.loads(f.read_text(encoding="utf-8"))
        req = entry.get("request") or {}
        if req.get("model") != model:
            continue
        for prefix, costs in per_prompt.items():
            if (req.get("system") or "").startswith(prefix):
                costs.append(_usd(entry["usage"], price))
    if not all(per_prompt.values()):
        raise ValueError("缓存里缺少上架或审核的调用记录，算不出每个产品的模型费用")
    listing = median(per_prompt[AMAZON_PROMPT]) + median(per_prompt[TIKTOK_PROMPT]) + 2 * median(per_prompt[REVIEW_PROMPT])
    live = json.loads(Path(live_run).read_text(encoding="utf-8"))
    calls = [r for r in live["records"] if r.get("meta")]
    return {
        "usd_per_inquiry": {"value": run["summary"]["usd_round1_plus_revision"]["median"],
                            "label": "每条询盘的模型费用（回复 + 改一轮，5 次调用）",
                            "source": f"eval/cost_run.json：{run['summary']['inquiries_with_revision']} 条回复并改了一轮的示例询盘取中位数，录制时的真实 token 用量 × {model} 官方价"},
        "usd_per_listing": {"value": round(listing, 4),
                            "label": "每个产品的上架文案模型费用（Amazon + TikTok 各生成一次、各审核一次）",
                            "source": f"app/cache/ 里录制调用的 token 用量中位数 × {model} 官方价"},
        "live_seconds_per_inquiry": {"value": round(sum(r["meta"]["seconds"] for r in calls), 1),
                                     "label": f"一条询盘从理解到校验完的耗时（{len(calls)} 次调用）",
                                     "source": f"docs/demo-runs/{Path(live_run).name}：{calls[0]['meta']['model']} 实时运行一次"},
    }


def validate(values):
    out = {}
    for key, raw in (values or {}).items():
        if key not in ASSUMPTIONS:
            raise ValueError(f"不认识的假设：{key}")
        try:
            v = float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"{ASSUMPTIONS[key][0]}要填数字")
        if not 0 <= v <= ASSUMPTIONS[key][3]:
            raise ValueError(f"{ASSUMPTIONS[key][0]}要在 0 到 {ASSUMPTIONS[key][3]} 之间")
        out[key] = v
    return {k: out.get(k, spec[2]) for k, spec in ASSUMPTIONS.items()}


def estimate(a, m):
    """Monthly figures from assumptions a and measured values m. A negative saving is shown as it is."""
    replies = a["inquiries_per_day"] * a["workdays_per_month"]
    hours = replies * (a["manual_minutes_per_reply"] - a["review_minutes_per_reply"]) / 60
    labor = hours * a["hourly_wage_cny"]
    outsourcing = a["listings_per_month"] * a["outsourcing_cny_per_listing"]
    model = (replies * m["usd_per_inquiry"]["value"] + a["listings_per_month"] * m["usd_per_listing"]["value"]) * a["usd_to_cny"]
    return {"replies_per_month": round(replies), "hours_saved": round(hours, 1), "labor_cny": round(labor),
            "outsourcing_cny": round(outsourcing), "model_cny": round(model), "net_cny": round(labor + outsourcing - model)}


# On-site timing (现场实测): a person times one reply by hand and one with TradeDesk. Kept apart from the
# assumptions; the page only uses them when someone presses "用实测替换假设", and always shows n.
TIMING_TASKS = {"manual": "人工回一条询盘（查资料、核对、写回复）", "tradedesk": "用 TradeDesk 生成 + 人工复核一条"}


class TimingLog:
    def __init__(self, path):
        self.path = Path(path)

    def load(self):
        return json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else []

    def _write(self, items):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")

    def add(self, payload):
        task = payload.get("task")
        if task not in TIMING_TASKS:
            raise ValueError("计时项目只能是“人工回一条”或“用 TradeDesk 生成 + 复核”")
        try:
            minutes = float(payload.get("minutes"))
        except (TypeError, ValueError):
            raise ValueError("用时要填数字（分钟）") from None
        if not 0.1 <= minutes <= 600:
            raise ValueError("用时要在 0.1 到 600 分钟之间")
        entry = {"ts": time.strftime("%Y-%m-%d %H:%M"), "task": task, "minutes": round(minutes, 1),
                 "inquiry_id": str(payload.get("inquiry_id") or "")[:20], "note": str(payload.get("note") or "")[:80]}
        self._write(self.load() + [entry])
        return entry

    def delete(self, index):
        items = self.load()
        if not isinstance(index, int) or not 0 <= index < len(items):
            raise ValueError("没有这条计时记录")
        del items[index]
        self._write(items)

    def summary(self, extra=None):
        """extra: {task: [minutes]} measured elsewhere, i.e. the time a salesperson recorded under a reply."""
        items = self.load()
        out = {}
        for task, label in TIMING_TASKS.items():
            more = list((extra or {}).get(task) or [])
            values = [e["minutes"] for e in items if e["task"] == task] + more
            out[task] = {"label": label, "n": len(values), "n_feedback": len(more),
                         "median": round(median(values), 1) if values else None}
        return {"tasks": out, "records": items}


def view(values=None, timings=None, feedback=None):
    m = measured()
    a = validate(values)
    return {"measured": m,
            "assumptions": [{"key": k, "label": s[0], "unit": s[1], "value": a[k], "example": s[2]} for k, s in ASSUMPTIONS.items()],
            "estimate": estimate(a, m), "replaces": REPLACES, "not_replaced": NOT_REPLACED, "unmeasured": UNMEASURED,
            "timings": timings.summary({"tradedesk": feedback_minutes(feedback)}) if timings else {"tasks": {}, "records": []}}


def feedback_minutes(feedback):
    """Minutes salespeople recorded under replies they sent (as is or edited); "not used" is no reply."""
    if not feedback:
        return []
    return [e["minutes"] for e in feedback.load() if e.get("minutes") is not None and e["outcome"] != "unused"]
