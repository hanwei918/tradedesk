"""规则出处自检: fetch each rule's source page again and look for its verbatim excerpt.

A rule is only as good as its source. This re-fetches every URL in kb/rules.json and
reports, per rule, whether the excerpt is still on the page. Pages that refuse scripts
(captcha, bot walls) or only render with JavaScript cannot be checked this way; they
are reported as such, with the date they were last verified by hand in a browser.
"""

import html
import json
import re
import ssl
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:  # optional: python.org installs on macOS ship without root certificates
    import certifi
except ImportError:
    certifi = None

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
# Why a fetch never reached the page (matched in the exception text), and what to do about it.
REASONS = (
    ("cert", ("CERTIFICATE_VERIFY_FAILED", "certificate verify failed"), "这台电脑的 Python 缺少根证书",
     "macOS：在“应用程序 / Python 3.x”里双击 Install Certificates.command，或运行 pip3 install certifi，再点重新抓取"),
    ("dns", ("gaierror", "nodename nor servname", "Name or service not known", "getaddrinfo", "name resolution"),
     "域名解析失败：网络没连上", "检查电脑是否联网；连不上也没关系，页面保留上次的结果"),
    ("timeout", ("timed out", "TimeoutError"), "连接超时：网络慢或被拦截", "部分官网在国内访问慢；换网络或开代理后再试"),
    ("proxy", ("ProxyError", "Tunnel connection failed", "407 Proxy"), "代理连不上", "检查系统代理或 VPN 设置"),
    ("refused", ("Connection refused", "ConnectionRefused", "Connection reset", "ConnectionReset"), "连接被拒绝或中断", "换网络后再试"),
)
REASON_ZH = {**{key: (zh, hint) for key, _, zh, hint in REASONS}, "network": ("网络错误", "检查网络后再试")}


def reason_of(detail):
    return next((key for key, needles, _, _ in REASONS if any(n in detail for n in needles)), "network")


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
        return dict(out, status="error", detail=repr(exc)[:160], reason=reason_of(repr(exc)))
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
        with urllib.request.urlopen(req, timeout=timeout, context=_CONTEXT) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read(4_000_000)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers.get("Content-Type", "") if exc.headers else "", exc.read(200_000) if exc.fp else b""


_CONTEXT = ssl.create_default_context(cafile=certifi.where()) if certifi else None


def check_all(rules, fetch=None, workers=8):
    started = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda r: check_rule(r, fetch), rules))
    summary = {k: sum(r["status"] == k for r in results) for k in STATUS_ZH}
    reasons = Counter(r["reason"] for r in results if r["status"] == "error")
    return {"checked_at": time.strftime("%Y-%m-%d %H:%M"), "seconds": round(time.time() - started, 1),
            "total": len(results), "summary": summary, "status_zh": STATUS_ZH, "detail_zh": DETAIL_ZH,
            "reasons": dict(reasons), "reason_zh": {k: REASON_ZH[k][0] for k in reasons}, "results": results}


def refresh(rules, fetch=None, path=None):
    """Re-check every source and save. A run that could not open a single page (offline, missing
    certificates) does not overwrite the last report: it comes back with the old one plus `attempt`."""
    path = Path(path or REPORT)
    report = check_all(rules, fetch)
    if not report["total"] or report["summary"]["error"] < report["total"]:
        return save(report, path)
    key = Counter(report["reasons"]).most_common(1)[0][0]
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    attempt = {"checked_at": report["checked_at"], "total": report["total"], "reason": key,
               "reason_zh": REASON_ZH[key][0], "hint_zh": REASON_ZH[key][1], "sample": report["results"][0].get("detail")}
    return dict(previous, attempt=attempt, kept=bool(previous))


def load():
    return json.loads(REPORT.read_text(encoding="utf-8")) if REPORT.exists() else None


def save(report, path=None):
    Path(path or REPORT).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report
