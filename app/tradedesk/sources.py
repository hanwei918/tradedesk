"""规则出处自检: fetch each rule's source page again and look for its verbatim excerpt.

A rule is only as good as its source. This re-fetches every URL in kb/rules.json and
reports, per rule, whether the excerpt is still on the page. Pages that refuse scripts
(captcha, bot walls) or only render with JavaScript cannot be checked this way; they
are reported as such, with the date they were last verified by hand in a browser.
"""

import html
import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / "kb" / "source_check.json"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/130.0 Safari/537.36")
# Verified by hand in a browser when the rules were written (see kb/SOURCES.md): these pages
# render their text with JavaScript, redirect scripts away, or answer them with a captcha or an
# empty page, so a plain fetch cannot see the text. PDFs are not parsed (standard library only).
BROWSER_ONLY = ("sellercentral.amazon.", "rule.aliexpress.com", "www.ebay.com", "rule.alibaba.com", "eur-lex.europa.eu")
BLOCK_MARKERS = re.compile(r"(?i)captcha|pardon our interruption|access denied|are you a robot|unusual traffic|"
                           r"enable javascript|request unsuccessful|incapsula|cf-chl|just a moment")
STATUS_ZH = {"found": "原文仍在", "browser": "需人工打开核对", "blocked": "网站拒绝程序抓取", "missing": "没找到，需人工复核",
             "error": "抓取失败"}
DETAIL_ZH = {"browser": "页面靠脚本显示、会把程序跳走，或是 PDF：程序看不到正文，建档时已在浏览器或用 pdftotext 逐字核对",
             "blocked": "网站对程序返回 403 或验证码（不绕过）", "missing": "页面能打开，但找不到这段原文：可能改版了，要人工复核",
             "error": "网络或证书问题"}


def page_text(raw, content_type=""):
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    for enc in ([m.group(1)] if m else []) + ["utf-8", "cp1252"]:
        try:
            text = raw.decode(enc)
            break
        except (LookupError, UnicodeDecodeError):
            continue
    else:
        text = raw.decode("utf-8", "replace")
    if "json" in (content_type or "").lower():
        try:
            return json.dumps(json.loads(text), ensure_ascii=False)
        except ValueError:
            pass
    text = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return html.unescape(text)


def squash(s):
    """Compare without whitespace and typographic quotes: HTML joins and splits text at tag edges."""
    s = (s or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", "", s).lower()


def check_rule(rule, fetch=None, timeout=20):
    url, excerpt = rule.get("url"), rule.get("excerpt") or ""
    out = {"id": rule["id"], "url": url, "verified_by_hand": rule.get("fetched")}
    fetch = fetch or _fetch
    try:
        status, content_type, raw = fetch(url, timeout)
    except Exception as exc:  # network down, DNS, TLS: report, never crash the check
        return dict(out, status="error", detail=repr(exc)[:160])
    browser = any(d in url for d in BROWSER_ONLY) or url.lower().split("?")[0].endswith(".pdf")
    if status in (401, 403, 429, 503):
        return dict(out, status="browser" if browser else "blocked", http=status)
    if raw[:5] == b"%PDF-" or "pdf" in (content_type or "").lower():
        return dict(out, status="browser", http=status)
    text = page_text(raw, content_type)
    if excerpt and squash(excerpt) in squash(text):
        return dict(out, status="found", http=status)
    if browser:
        return dict(out, status="browser", http=status)
    if BLOCK_MARKERS.search(text[:20000]) or len(squash(text)) < 400:
        return dict(out, status="blocked", http=status)
    return dict(out, status="missing", http=status)


def _fetch(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read(4_000_000)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers.get("Content-Type", "") if exc.headers else "", exc.read(200_000) if exc.fp else b""


def check_all(rules, fetch=None, workers=8):
    started = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda r: check_rule(r, fetch), rules))
    summary = {k: sum(r["status"] == k for r in results) for k in STATUS_ZH}
    return {"checked_at": time.strftime("%Y-%m-%d %H:%M"), "seconds": round(time.time() - started, 1),
            "total": len(results), "summary": summary, "status_zh": STATUS_ZH, "detail_zh": DETAIL_ZH,
            "results": results}


def load():
    return json.loads(REPORT.read_text(encoding="utf-8")) if REPORT.exists() else None


def save(report):
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report
