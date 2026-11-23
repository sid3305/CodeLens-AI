"""
LLM provider layer (B6).

Every request goes through ``call_llm``, which redacts secrets from every
message before it leaves the machine and turns any provider failure into
an ``AIServiceError`` whose message is safe to show to a user: no raw
provider JSON, no key fragments, no local paths.

Providers are chosen with ``CODELENS_LLM_PROVIDER``:
- ``groq`` (default): ``GROQ_API_KEY``, model ``CODELENS_GROQ_MODEL``.
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
    name = "Groq"

    def __init__(self):
        self.model = os.getenv("CODELENS_GROQ_MODEL") or MODEL_NAME
        self._api_key = os.getenv("GROQ_API_KEY") or ""
        self.configured = bool(self._api_key)

    def complete(self, messages, max_tokens):
        if not self.configured:
            raise AINotConfiguredError(
                "AI is not set up: add GROQ_API_KEY to .env and restart the backend."
            )
        try:
            client = Groq(api_key=self._api_key)
            response = client.chat.completions.create(
                model=self.model, messages=messages, max_tokens=max_tokens, temperature=0
            )
            return response.choices[0].message.content or ""
        except AIServiceError:
            raise
        except Exception as error:  # noqa: BLE001 - every provider failure is mapped
            raise self._clean(error) from None

    def _clean(self, error: Exception) -> AIServiceError:
        # Log the kind of failure only: provider messages can echo key fragments.
        status = _status_code(error)
        logger.warning("Groq request failed: %s (status %s)", type(error).__name__, status)
        kind = type(error).__name__.lower()
        if status == 401 or status == 403 or "authentication" in kind or "permission" in kind:
            return AIServiceError("Groq rejected the API key. Check GROQ_API_KEY in .env.")
        if status == 413:
            return AIServiceError(
                "Groq refused the request as too large for your plan's per-minute token limit. "
                f"Lower CODELENS_LLM_MAX_INPUT_TOKENS (now {max_input_tokens()}) or select less code."
            )
        if status == 429 or "ratelimit" in kind:
            return AIServiceError(
                "Groq's per-minute limit was reached. Wait a minute, or lower "
                f"CODELENS_LLM_MAX_INPUT_TOKENS (now {max_input_tokens()})."
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
        return {"provider": "none", "model": "", "configured": False, "problem": str(error)}
    return {"provider": provider.name, "model": provider.model, "configured": provider.configured, "problem": None}


def call_llm(prompt: str, max_tokens: int | None = None, *, system: str | None = None) -> str:
    """
    The one way out. Every message is redacted, the token budget is checked
    before sending (TokenBudgetError, nothing sent), and the answer length
    is capped at CODELENS_LLM_MAX_OUTPUT_TOKENS. Never retried.
    """

    request = LlmRequest(
        system=redact_secrets(system or ""),
        prompt=redact_secrets(prompt),
        max_output=min(max_tokens or max_output_tokens(), max_output_tokens()),
    )
    check(request)
    messages = []
    if request.system:
        messages.append({"role": "system", "content": request.system})
    messages.append({"role": "user", "content": request.prompt})
    return get_provider().complete(messages, request.max_output)
