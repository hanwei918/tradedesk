"""Model cost per inquiry, read from the call log.

Every cached model response is counted once, so replaying the demo does not inflate the numbers.
"""

import statistics

# USD per million tokens (input, output). Source: Anthropic API price list for claude-opus-5-5 (2026-10).
# Other models (e.g. the Tokenhub one used on site) report tokens only.
PRICES = {"claude-opus-5-5": (4.00, 20.00)}


def usd(model, input_tokens, output_tokens):
    p = PRICES.get(model)
    return None if p is None else round((input_tokens * p[0] + output_tokens * p[1]) / 1e6, 4)


def inquiry_runs(rows, inquiries):
    """Workflow-A log rows -> {inquiry_id: {"round1": [run, ...], "revise": [run, ...]}}."""
    runs = {}
    for r in rows:
        if r.get("workflow") == "A 询盘回复" and (r.get("meta") or {}).get("usage"):
            runs.setdefault(r["run_id"], []).append(r)
    seen, out = set(), {}
    for steps in runs.values():
        key = tuple(s["meta"].get("cache_key") for s in steps)
        if key in seen:  # the same responses replayed under a new run id
            continue
        seen.add(key)
        qid = next((q["id"] for s in steps for q in inquiries
                    if q["text"].strip()[:80] in s.get("input_preview", "")), None)
        kind = "round1" if any(s["step"] == "理解询盘" for s in steps) else "revise"
        tin = sum(s["meta"]["usage"]["input_tokens"] for s in steps)
        tout = sum(s["meta"]["usage"]["output_tokens"] for s in steps)
        model = steps[0]["meta"].get("model")
        out.setdefault(qid, {}).setdefault(kind, []).append(
            {"calls": len(steps), "input_tokens": tin, "output_tokens": tout, "model": model,
             "usd": usd(model, tin, tout)})
    return out


def summarize(per_inquiry):
    """First round alone, and first round plus one revision, across inquiries."""
    first = [v["round1"][0] for q, v in per_inquiry.items() if q and v.get("round1")]
    both = [v["round1"][0]["usd"] + v["revise"][0]["usd"] for q, v in per_inquiry.items()
            if q and v.get("round1") and v.get("revise") and v["round1"][0]["usd"] is not None
            and v["revise"][0]["usd"] is not None]
    priced = [r["usd"] for r in first if r["usd"] is not None]

    def spread(xs):
        return {"min": round(min(xs), 4), "median": round(statistics.median(xs), 4), "max": round(max(xs), 4)} if xs else None

    return {
        "inquiries": len(first),
        "calls_round1": sorted({r["calls"] for r in first}),
        "tokens_round1": spread([r["input_tokens"] + r["output_tokens"] for r in first]),
        "usd_round1": spread(priced),
        "inquiries_with_revision": len(both),
        "usd_round1_plus_revision": spread(both),
    }
