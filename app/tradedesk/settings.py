"""Model settings edited from the web page, stored in app/.env.

The key is written to app/.env (git-ignored, mode 600) and is never sent back
to the browser: reads return only whether a key is set and its last 4 chars.
Changing the endpoint or provider requires typing the key again, so a saved
key can never be redirected to a new host without the person re-entering it.
"""

import os
import re
from pathlib import Path

from .llm import ANTHROPIC_DEFAULT_BASE, ANTHROPIC_DEFAULT_MODEL, DEFAULT_ENDPOINT, DEFAULT_MODEL, normalize_endpoint

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
MODES = ("live", "record", "replay")
PROVIDERS = ("openai", "anthropic")
MANAGED = ("LLM_PROVIDER", "LLM_ENDPOINT", "ANTHROPIC_API_BASE", "LLM_MODEL", "LLM_API_KEY",
           "ANTHROPIC_API_KEY", "TRADEDESK_MODE")


def read_env(path=ENV_PATH):
    values = {}
    if Path(path).exists():
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$", line)
            if m:
                values[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return values


def current(path=ENV_PATH):
    v = read_env(path)
    provider = v.get("LLM_PROVIDER") or "openai"
    if provider == "anthropic":
        endpoint = v.get("ANTHROPIC_API_BASE") or ANTHROPIC_DEFAULT_BASE
        key = v.get("ANTHROPIC_API_KEY", "")
        model = v.get("LLM_MODEL") or ANTHROPIC_DEFAULT_MODEL
    else:
        endpoint = v.get("LLM_ENDPOINT") or DEFAULT_ENDPOINT
        key = v.get("LLM_API_KEY", "")
        model = v.get("LLM_MODEL") or DEFAULT_MODEL
    return {"provider": provider, "endpoint": endpoint, "model": model, "api_key": key,
            "mode": v.get("TRADEDESK_MODE") or ("live" if key else "replay")}


def public_view(path=ENV_PATH):
    """What the browser may see: never the key itself."""
    c = current(path)
    key = c.pop("api_key")
    c["key_set"] = bool(key)
    c["key_hint"] = f"…{key[-4:]}" if len(key) >= 8 else ("已设置" if key else "")
    c["env_overrides"] = [k for k in MANAGED if os.environ.get(k)]
    return c


def validate(new, old):
    provider = new.get("provider") or old["provider"]
    if provider not in PROVIDERS:
        raise ValueError("接口类型只能是 OpenAI 兼容 或 Claude")
    endpoint = (new.get("endpoint") or "").strip() or old["endpoint"]
    if not re.match(r"^https://[\w.-]+(:\d+)?(/[\w./%-]*)?$", endpoint) and not re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?(/[\w./%-]*)?$", endpoint):
        raise ValueError("接口地址必须是 https:// 开头的网址")
    model = (new.get("model") or "").strip() or old["model"]
    if not re.match(r"^[\w./:-]{1,100}$", model):
        raise ValueError("模型名格式不对")
    mode = new.get("mode") or old["mode"]
    if mode not in MODES:
        raise ValueError("模式只能是 实时 / 录制 / 回放")
    key = (new.get("api_key") or "").strip()
    if key and (len(key) > 400 or re.search(r"\s", key)):
        raise ValueError("key 格式不对（不能有空格或换行）")
    endpoint = normalize_endpoint(provider, endpoint)  # …/v1 from the Tokenhub guide becomes the full URL
    moved = provider != old["provider"] or endpoint != normalize_endpoint(provider, old["endpoint"])
    # A saved key is never carried over to a new provider or endpoint.
    final_key = key or ("" if moved else old["api_key"])
    if mode in ("live", "record") and not final_key:
        raise ValueError("实时 / 录制模式需要 key" + ("：换了接口类型或地址，请重新填写 key（旧 key 不会被发往新地址）" if moved and old["api_key"] else ""))
    return {"provider": provider, "endpoint": endpoint, "model": model, "mode": mode, "api_key": final_key}


def save(new, path=ENV_PATH):
    """Validate and write the managed keys; other lines in .env are kept as they are."""
    path = Path(path)
    v = validate(new, current(path))
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    kept = [l for l in lines if not re.match(r"\s*(%s)\s*=" % "|".join(MANAGED), l)]
    out = kept + ["", "# 以下由网页“模型设置”写入", f"LLM_PROVIDER={v['provider']}", f"LLM_MODEL={v['model']}",
                  f"TRADEDESK_MODE={v['mode']}"]
    if v["provider"] == "anthropic":
        out += [f"ANTHROPIC_API_BASE={v['endpoint']}", f"ANTHROPIC_API_KEY={v['api_key']}"]
    else:
        out += [f"LLM_ENDPOINT={v['endpoint']}", f"LLM_API_KEY={v['api_key']}"]
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(l for i, l in enumerate(out) if l or (i and out[i - 1])) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)
    return v
