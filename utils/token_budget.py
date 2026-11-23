"""
Token budget for every LLM request (checked before anything is sent).

Tokens are estimated as ceil(characters / 4): no tokenizer dependency, and
slightly pessimistic for code. Defaults fit the smallest free tiers; raise
them with CODELENS_LLM_MAX_INPUT_TOKENS / CODELENS_LLM_MAX_OUTPUT_TOKENS.
"""

import math
import os
from dataclasses import dataclass

DEFAULT_MAX_INPUT_TOKENS = 3000
DEFAULT_MAX_OUTPUT_TOKENS = 700


class TokenBudgetError(ValueError):
    """The request cannot fit the budget; nothing was sent."""


def estimate_tokens(text: str | None) -> int:
    return math.ceil(len(text or "") / 4)


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


def max_input_tokens() -> int:
    return _positive_int("CODELENS_LLM_MAX_INPUT_TOKENS", DEFAULT_MAX_INPUT_TOKENS)


def max_output_tokens() -> int:
    return _positive_int("CODELENS_LLM_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS)


@dataclass(frozen=True)
class LlmRequest:
    """Exactly what would be sent: used both to estimate and to send."""

    system: str
    prompt: str
    max_output: int

    @property
    def input_tokens(self) -> int:
        return estimate_tokens(self.system) + estimate_tokens(self.prompt)


def check(request: LlmRequest) -> None:
    limit = max_input_tokens()
    if request.input_tokens > limit:
        raise TokenBudgetError(
            f"This request is about {request.input_tokens} tokens, over the limit of {limit} "
            "(CODELENS_LLM_MAX_INPUT_TOKENS). Select less code, or raise the limit if your plan allows it."
        )


def fit_sections(head: str, sections: list[str], tail: str = "", *, reserved: int = 0) -> tuple[str, int]:
    """
    Join head + sections + tail, dropping sections from the end (lowest
    priority) until the text fits max_input_tokens() - reserved.
    Returns the text and how many sections were dropped.
    """

    budget = max_input_tokens() - reserved
    kept = list(sections)
    while True:
        text = "\n\n".join(part for part in [head, *kept, tail] if part)
        if estimate_tokens(text) <= budget or not kept:
            break
        kept.pop()
    if estimate_tokens(text) > budget:
        raise TokenBudgetError(
            f"Even the smallest form of this request is over the limit of {max_input_tokens()} tokens "
            "(CODELENS_LLM_MAX_INPUT_TOKENS)."
        )
    return text, len(sections) - len(kept)


def trim_to_tokens(text: str, tokens: int) -> tuple[str, bool]:
    """Cut text to about `tokens` tokens on a line boundary; returns (text, trimmed)."""

    limit = max(tokens, 0) * 4
    if len(text) <= limit:
        return text, False
    cut = text[:limit]
    newline = cut.rfind("\n")
    return (cut[:newline] if newline > limit // 2 else cut), True
