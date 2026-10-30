"""OpenAI-compatible chat client with a record/replay cache.

Three modes, chosen with TRADEDESK_MODE:
- live    call the model every time (default when a key is present)
- record  call the model and save each response under cache/
- replay  never call the network; answer from cache/ only (stable stage demo)

The cache key is the SHA-256 of the exact request body, so a replayed answer is
only ever returned for the identical request that produced it.
"""

import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "cache"

# The event's Tokenhub (api.tokenhubcloud.net). Model names depend on the key: list them with /v1/models.
DEFAULT_ENDPOINT = "https://api.tokenhubcloud.net/v1/chat/completions"
DEFAULT_MODEL = "deepseek/deepseek-flash"
# Tokenhub sits behind Cloudflare, which answers urllib's default "Python-urllib/3.x" with 403 "error code: 1010"
# (checked 2026-10-30, with a real token and a made-up one alike). Any other name gets through.
USER_AGENT = "TradeDesk/1.0"
# LLM_PROVIDER=anthropic switches to the Claude Messages API (official SDK).
ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5"
ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com"
ANTHROPIC_OFFICIAL_HOST = "api.anthropic.com"


class LLMError(RuntimeError):
    pass


def chat_url(endpoint):
    """Accept the base URL the Tokenhub guide hands out (…/v1) as well as the full …/chat/completions."""
    url = endpoint.strip().rstrip("/")
    if url.endswith("/chat/completions"):
        return url
    if urllib.parse.urlparse(url).path in ("", "/"):
        url += "/v1"
    return url + "/chat/completions"


def models_url(endpoint):
    return chat_url(endpoint)[:-len("/chat/completions")] + "/models"


def anthropic_base(endpoint):
    """The SDK appends /v1/messages itself, so a pasted …/v1 would be doubled."""
    url = endpoint.strip().rstrip("/")
    return url[:-3] if url.endswith("/v1") else url


def is_official_anthropic(endpoint):
    return urllib.parse.urlparse(endpoint).hostname == ANTHROPIC_OFFICIAL_HOST


def normalize_endpoint(provider, endpoint):
    return anthropic_base(endpoint) if provider == "anthropic" else chat_url(endpoint)


def anthropic_request(endpoint, body):
    """Messages API arguments. Effort, fallbacks and the beta flag go to the official API only:
    a gateway such as Tokenhub may reject fields it does not know."""
    kw = {"model": body["model"], "max_tokens": 16000,
          "system": body["system"] + "\n\n只输出一个 JSON 对象，不要输出任何其他文字或代码块标记。",
          "messages": body["messages"]}
    if is_official_anthropic(endpoint):
        kw.update(output_config={"effort": body["effort"]},
                  betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    return kw


def model_ids(payload):
    """ids from an OpenAI-style {"data": [{"id": ...}]} model list."""
    return sorted({m["id"] for m in (payload or {}).get("data") or [] if isinstance(m, dict) and m.get("id")})


def _env_file_value(name):
    env = ROOT / ".env"
    if not env.exists():
        return None
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    return None


def setting(name, default=None):
    return os.environ.get(name) or _env_file_value(name) or default


class LLM:
    def __init__(self, endpoint=None, model=None, api_key=None, mode=None,
                 transport=None, cache_dir=None, timeout=120, provider=None):
        self.provider = provider or setting("LLM_PROVIDER", "openai")
        if self.provider == "anthropic":
            self.endpoint = endpoint or setting("ANTHROPIC_API_BASE", ANTHROPIC_DEFAULT_BASE)
            self.model = model or setting("LLM_MODEL", ANTHROPIC_DEFAULT_MODEL)
            self.api_key = api_key if api_key is not None else setting("ANTHROPIC_API_KEY")
            default_transport = self._anthropic
        else:
            self.endpoint = endpoint or setting("LLM_ENDPOINT", DEFAULT_ENDPOINT)
            self.model = model or setting("LLM_MODEL", DEFAULT_MODEL)
            self.api_key = api_key if api_key is not None else setting("LLM_API_KEY")
            default_transport = self._http
        self.endpoint = normalize_endpoint(self.provider, self.endpoint)
        self.effort = setting("LLM_EFFORT", "medium")
        if self.provider == "anthropic" and timeout == 120:
            timeout = 300  # thinking is always on for claude-opus-5-5
        self.mode = mode or setting("TRADEDESK_MODE") or ("live" if self.api_key else "replay")
        self.transport = transport or default_transport
        self._client = None
        self.cache_dir = Path(cache_dir) if cache_dir else CACHE_DIR
        self.timeout = timeout

    def describe(self):
        return {"provider": self.provider, "endpoint": self.endpoint, "model": self.model, "mode": self.mode}

    def body(self, system, user, image=None):
        """image: optional {"media_type": "image/png", "data": <base64>} sent before the text."""
        if self.provider == "anthropic":
            content = user
            if image:
                content = [{"type": "image", "source": {"type": "base64", "media_type": image["media_type"],
                                                        "data": image["data"]}},
                           {"type": "text", "text": user}]
            return {"provider": "anthropic", "model": self.model, "effort": self.effort,
                    "system": system, "messages": [{"role": "user", "content": content}]}
        content = user
        if image:
            content = [{"type": "image_url", "image_url": {"url": f"data:{image['media_type']};base64,{image['data']}"}},
                       {"type": "text", "text": user}]
        return {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": content}],
            "temperature": 0,
            "seed": 42,
            "response_format": {"type": "json_object"},
            # The event's Tokenhub (GPT models only) rejects "none" with HTTP 400; low is its cheapest level.
            "reasoning_effort": "low",
        }

    @staticmethod
    def key_for(body):
        raw = json.dumps(body, ensure_ascii=False, sort_keys=True).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def chat_json(self, system, user, image=None):
        """Return (parsed_json, meta). meta records how the answer was obtained."""
        body = self.body(system, user, image)
        key = self.key_for(body)
        path = self.cache_dir / f"{key}.json"
        started = time.time()
        usage = None
        if self.mode == "replay" or (self.mode == "record" and path.exists()):
            if not path.exists():
                raise LLMError("回放模式下没有这条请求的缓存，请切换到 live 或 record 模式")
            cached = json.loads(path.read_text(encoding="utf-8"))
            content, usage = cached["content"], cached.get("usage")
            source = "replay"
        else:
            self.last_usage = None
            content = self.transport(body)
            usage = getattr(self, "last_usage", None)
            source = "live"
            if self.mode == "record":
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps({"request": _without_image_bytes(body), "content": content, "usage": usage},
                                           ensure_ascii=False, indent=1), encoding="utf-8")
        try:
            data = json.loads(content)
        except json.JSONDecodeError as exc:
            raise LLMError(f"模型没有返回合法 JSON：{exc}") from exc
        meta = {"source": source, "cache_key": key[:12], "model": self.model,
                "seconds": round(time.time() - started, 2), "usage": usage}
        return data, meta

    def _http(self, body):
        if not self.api_key:
            raise LLMError("没有配置 LLM_API_KEY")
        req = urllib.request.Request(
            self.endpoint, data=json.dumps(body).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT,
                     "Authorization": f"Bearer {self.api_key}"})
        last = None
        for attempt in range(1 if self.timeout <= 20 else 3):  # connection tests try once
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                u = payload.get("usage") or {}
                self.last_usage = {"input_tokens": u.get("prompt_tokens"), "output_tokens": u.get("completion_tokens")}
                return payload["choices"][0]["message"]["content"]
            except urllib.error.HTTPError as exc:
                last = f"HTTP {exc.code}: {exc.read()[:300]!r}"
                if exc.code < 500 and exc.code != 429:
                    break
            except (urllib.error.URLError, TimeoutError, KeyError) as exc:
                last = repr(exc)
            time.sleep(1.5 * (attempt + 1))
        raise LLMError(f"模型调用失败：{last}")

    def list_models(self):
        """Model ids this key may use: the guide's /v1/models check, so nobody has to guess a name."""
        if not self.api_key:
            raise LLMError("还没有填写 key")
        if self.provider == "anthropic":
            import anthropic

            try:
                return sorted({m.id for m in self._anthropic_client().models.list(limit=100) if getattr(m, "id", None)})
            except anthropic.APIStatusError as exc:
                raise LLMError(f"HTTP {exc.status_code}: {exc.message}") from exc
            except anthropic.APIConnectionError as exc:
                raise LLMError(f"连不上接口：{exc!r}") from exc
        req = urllib.request.Request(models_url(self.endpoint),
                                     headers={"Authorization": f"Bearer {self.api_key}", "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return model_ids(json.loads(resp.read().decode("utf-8")))
        except urllib.error.HTTPError as exc:
            raise LLMError(f"HTTP {exc.code}: {exc.read()[:300]!r}") from exc
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            raise LLMError(repr(exc)) from exc

    def _anthropic_client(self):
        import anthropic  # only needed for this provider

        if self._client is None:
            # The official API takes x-api-key; gateways such as Tokenhub take the same key as a Bearer token
            # (what ANTHROPIC_AUTH_TOKEN does in Claude Code). Explicit credentials and base_url mean
            # ANTHROPIC_* variables in the shell are never picked up.
            # gzip only: some Python installs ship a brotli/zstd decoder the HTTP client can't drive.
            auth = {"api_key": self.api_key} if is_official_anthropic(self.endpoint) else {"auth_token": self.api_key}
            self._client = anthropic.Anthropic(**auth, base_url=self.endpoint,
                                               timeout=self.timeout, max_retries=2,
                                               default_headers={"Accept-Encoding": "gzip"})
        return self._client

    def _anthropic(self, body):
        """Claude Messages API via the official SDK. Returns the JSON text of the answer."""
        import anthropic  # only needed for this provider

        if not self.api_key:
            raise LLMError("没有配置 ANTHROPIC_API_KEY")
        client = self._anthropic_client()
        kw = anthropic_request(self.endpoint, body)
        try:
            msg = (client.beta.messages if "betas" in kw else client.messages).create(**kw)
        except anthropic.AuthenticationError as exc:
            raise LLMError("Claude API key 无效") from exc
        except anthropic.RateLimitError as exc:
            raise LLMError("Claude API 限流，请稍后再试") from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(f"Claude API 错误 HTTP {exc.status_code}: {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError("连不上 Claude API，请检查网络") from exc
        self.last_usage = {"input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens}
        if msg.stop_reason == "refusal":
            raise LLMError("模型拒绝了这次请求")
        if msg.stop_reason == "max_tokens":
            raise LLMError("模型输出被截断（max_tokens）")
        text = "".join(b.text for b in msg.content if b.type == "text").strip()
        return _strip_fence(text)


def _without_image_bytes(body):
    """Cache files keep a hash of the image instead of the image itself."""
    text = json.dumps(body, ensure_ascii=False)
    for marker in ('"data": "', 'base64,'):
        start = 0
        while True:
            i = text.find(marker, start)
            if i < 0:
                break
            j = i + len(marker)
            k = text.find('"', j)
            blob = text[j:k]
            if len(blob) > 200:
                digest = hashlib.sha256(blob.encode()).hexdigest()[:16]
                text = text[:j] + f"<image sha256 {digest}, {len(blob)} b64 chars>" + text[k:]
            start = j + 1
    return json.loads(text)


def _strip_fence(text):
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0]
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if start >= 0 and end > start else text
