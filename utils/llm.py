"""
LLM provider layer (B6).

Every request goes through ``call_llm``, which redacts secrets from every
message before it leaves the machine and turns any provider failure into
an ``AIServiceError`` whose message is safe to show to a user: no raw
provider JSON, no key fragments, no local paths.

Providers are chosen with ``CODELENS_LLM_PROVIDER``:
- ``groq`` (default): ``GROQ_API_KEY`` and/or a pool in ``GROQ_API_KEYS``
  (rotated per request, see utils/groq_keys.py), model ``CODELENS_GROQ_MODEL``.
- ``ollama``: a local Ollama server at ``OLLAMA_BASE_URL``
  (default http://localhost:11434), model ``CODELENS_OLLAMA_MODEL``.
"""

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Protocol

from groq import Groq

# Importing config loads the project's .env file.
import utils.config  # noqa: F401
from utils.groq_keys import get_pool, retry_after_seconds
from utils.security import redact_secrets
from utils.token_budget import LlmRequest, check, max_input_tokens, max_output_tokens

logger = logging.getLogger(__name__)

MODEL_NAME = "openai/gpt-oss-120b"
OLLAMA_DEFAULT_MODEL = "llama3.1"
OLLAMA_DEFAULT_URL = "http://localhost:11434"
OLLAMA_TIMEOUT_SECONDS = 300


class AIServiceError(RuntimeError):
    """A provider failure, with a message safe to show to the user."""


class AINotConfiguredError(AIServiceError):
    """AI cannot be used until the provider is configured."""


class Provider(Protocol):
    name: str
    model: str
    configured: bool

    def complete(self, messages: list[dict[str, str]], max_tokens: int) -> str: ...


def _status_code(error: Exception) -> int | None:
    for attribute in ("status_code", "status"):
        value = getattr(error, attribute, None)
        if isinstance(value, int):
            return value
    response = getattr(error, "response", None)
    value = getattr(response, "status_code", None)
    return value if isinstance(value, int) else None


class GroqProvider:
    """
    Groq with a pool of API keys (GROQ_API_KEYS and/or GROQ_API_KEY).
    A key that is rate-limited or rejected is set aside and the same request
    goes to the next key; any other failure is reported at once.
    """

    name = "Groq"

    def __init__(self):
        self.model = os.getenv("CODELENS_GROQ_MODEL") or MODEL_NAME
        self._pool = get_pool()
        self.configured = len(self._pool) > 0

    @property
    def key_count(self) -> int:
        return len(self._pool)

    def complete(self, messages, max_tokens):
        if not self.configured:
            raise AINotConfiguredError(
                "AI is not set up: add GROQ_API_KEY (or several keys in GROQ_API_KEYS) to .env "
                "and restart the backend."
            )
        tried: set[int] = set()
        last: AIServiceError | None = None
        while True:
            index = self._pool.acquire(skip=tried)
            if index is None:
                raise last or self._all_resting()
            tried.add(index)
            try:
                client = Groq(api_key=self._pool.keys[index])
                response = client.chat.completions.create(
                    model=self.model, messages=messages, max_tokens=max_tokens, temperature=0,
                    **({"reasoning_effort": "low"} if is_reasoning_model(self.model) else {}),
                )
                return response.choices[0].message.content or ""
            except AIServiceError:
                raise
            except Exception as error:  # noqa: BLE001 - every provider failure is mapped
                status = _status_code(error)
                kind = type(error).__name__.lower()
                if status == 429 or "ratelimit" in kind:
                    # This key's per-minute limit: rest it and try the next key.
                    self._pool.rest(index, retry_after_seconds(error))
                    logger.warning("Groq key #%d is rate-limited; trying the next key", index + 1)
                    last = self._clean(error)
                    continue
                if status in (401, 403) or "authentication" in kind or "permission" in kind:
                    self._pool.reject(index)
                    logger.warning("Groq rejected key #%d; it is not used again until restart", index + 1)
                    last = self._clean(error)
                    continue
                raise self._clean(error) from None

    def _all_resting(self) -> AIServiceError:
        status = self._pool.status()
        if status["rejected"] == status["total"]:
            which = "the API key" if status["total"] == 1 else "every API key"
            return AIServiceError(f"Groq rejected {which}. Check GROQ_API_KEY / GROQ_API_KEYS in .env.")
        wait = max(1, round(float(status["next_ready_seconds"])))
        return AIServiceError(
            f"All {status['total']} Groq key(s) reached their per-minute limit. "
            f"Try again in about {wait} seconds, or add more keys to GROQ_API_KEYS."
        )

    def _clean(self, error: Exception) -> AIServiceError:
        # Log the kind of failure only: provider messages can echo key fragments.
        status = _status_code(error)
        logger.warning("Groq request failed: %s (status %s)", type(error).__name__, status)
        kind = type(error).__name__.lower()
        if status == 401 or status == 403 or "authentication" in kind or "permission" in kind:
            return AIServiceError("Groq rejected the API key. Check GROQ_API_KEY / GROQ_API_KEYS in .env.")
        if status == 413:
            return AIServiceError(
                "Groq refused the request as too large for your plan's per-minute token limit. "
                f"Lower CODELENS_LLM_MAX_INPUT_TOKENS (now {max_input_tokens()}) or select less code."
            )
        if status == 429 or "ratelimit" in kind:
            return AIServiceError(
                "Groq's per-minute limit was reached on every key. Wait a minute, add more keys to "
                f"GROQ_API_KEYS, or lower CODELENS_LLM_MAX_INPUT_TOKENS (now {max_input_tokens()})."
            )
        if isinstance(error, (ConnectionError, TimeoutError, OSError)) or "connection" in kind or "timeout" in kind:
            return AIServiceError("Could not reach Groq. Check your connection and try again.")
        return AIServiceError("Groq returned an error. Try again later.")


class OllamaProvider:
    """A local Ollama server: code never leaves this machine."""

    name = "Ollama"
    configured = True

    def __init__(self):
        self.model = os.getenv("CODELENS_OLLAMA_MODEL") or OLLAMA_DEFAULT_MODEL
        base = (os.getenv("OLLAMA_BASE_URL") or OLLAMA_DEFAULT_URL).rstrip("/")
        if not base.startswith(("http://", "https://")):
            raise AINotConfiguredError("OLLAMA_BASE_URL must start with http:// or https://.")
        self._url = f"{base}/api/chat"

    def complete(self, messages, max_tokens):
        body = json.dumps({
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {"num_predict": max_tokens, "temperature": 0},
        }).encode("utf-8")
        request = urllib.request.Request(
            self._url, data=body, headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=OLLAMA_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read())
            return payload["message"]["content"] or ""
        except urllib.error.HTTPError as error:
            logger.warning("Ollama request failed: HTTP %s", error.code)
            if error.code == 404:
                raise AIServiceError(
                    f"Ollama does not have the model {self.model}. Run: ollama pull {self.model}"
                ) from None
            raise AIServiceError("Ollama returned an error. Try again later.") from None
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
            raise AIServiceError("Could not reach Ollama. Check that it is running and try again.") from None
        except (KeyError, TypeError, ValueError):
            raise AIServiceError("Ollama returned an answer CodeLens could not read.") from None


PROVIDERS = {"groq": GroqProvider, "ollama": OllamaProvider}

# Reasoning models spend output tokens on hidden reasoning before answering.
REASONING_MODELS = ("openai/gpt-oss", "gpt-oss", "deepseek-r1", "qwen/qwen3", "qwen3")


def is_reasoning_model(model: str) -> bool:
    return model.lower().startswith(REASONING_MODELS)


def effective_output_tokens(requested: int | None) -> int:
    """
    The output allowance actually sent. Reasoning models get the whole
    budget: with a small cap their reasoning uses it up and the answer is
    empty. The prompts still ask for short answers.
    """

    limit = max_output_tokens()
    try:
        model = get_provider().model
    except AINotConfiguredError:
        model = ""
    if is_reasoning_model(model):
        return limit
    return min(requested or limit, limit)


def get_provider() -> Provider:
    choice = (os.getenv("CODELENS_LLM_PROVIDER") or "groq").strip().lower()
    factory = PROVIDERS.get(choice)
    if factory is None:
        raise AINotConfiguredError(
            f"Unknown AI provider '{choice}' in CODELENS_LLM_PROVIDER. Use groq or ollama."
        )
    return factory()


def provider_info() -> dict[str, object]:
    """Who receives the code: shown to the user before they consent."""

    try:
        provider = get_provider()
    except AINotConfiguredError as error:
        return {"provider": "none", "model": "", "configured": False, "problem": str(error), "keys": 0}
    return {
        "provider": provider.name,
        "model": provider.model,
        "configured": provider.configured,
        "problem": None,
        "keys": getattr(provider, "key_count", 0),
    }


def call_llm(prompt: str, max_tokens: int | None = None, *, system: str | None = None) -> str:
    """
    The one way out. Every message is redacted, the token budget is checked
    before sending (TokenBudgetError, nothing sent), and the answer length
    is capped at CODELENS_LLM_MAX_OUTPUT_TOKENS. Never retried on the same
    key: only a rate-limited or rejected Groq key hands it to the next key.
    """

    request = LlmRequest(
        system=redact_secrets(system or ""),
        prompt=redact_secrets(prompt),
        max_output=effective_output_tokens(max_tokens),
    )
    check(request)
    messages = []
    if request.system:
        messages.append({"role": "system", "content": request.system})
    messages.append({"role": "user", "content": request.prompt})
    answer = get_provider().complete(messages, request.max_output)
    if not (answer or "").strip():
        # Never saved or cached: an empty answer is a failure, not a result.
        raise AIServiceError(
            "The AI returned an empty answer (its output limit was used up). "
            f"Raise CODELENS_LLM_MAX_OUTPUT_TOKENS (now {max_output_tokens()}) and try again."
        )
    return answer
