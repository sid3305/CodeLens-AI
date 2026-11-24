"""
Repository chat: one question, answered from a compact fact sheet, a few
relevant code excerpts and the end of the conversation.

Everything is fitted to the token budget before sending. Parts are kept in
priority order (question, best excerpt, overview, latest turns, other
excerpts, other facts, older turns) and the rest is left out.
"""

from dataclasses import dataclass

from prompts.prompts import CHAT_SYSTEM, MAX_OUTPUT, repo_data
from utils.llm import call_llm
from utils.security import redact_secrets
from utils.token_budget import (
    LlmRequest,
    TokenBudgetError,
    estimate_tokens,
    max_input_tokens,
    max_output_tokens,
)

HISTORY_MESSAGES = 6
HISTORY_CHARS = 600


@dataclass(frozen=True)
class Excerpt:
    file: str
    start_line: int
    end_line: int
    text: str

    def render(self) -> str:
        numbered = "\n".join(
            f"{self.start_line + offset}| {line}" for offset, line in enumerate(self.text.splitlines())
        )
        return f"--- {self.file} (lines {self.start_line}-{self.end_line}) ---\n{numbered}"


def _history_lines(history: list[dict]) -> list[str]:
    lines = []
    for message in history[-HISTORY_MESSAGES:]:
        content = (message.get("content") or "").strip()
        if len(content) > HISTORY_CHARS:
            content = content[: HISTORY_CHARS - 1] + "…"
        speaker = "User" if message.get("role") == "user" else "Assistant"
        lines.append(f"{speaker}: {content}")
    return lines


def _render(question: str, facts: list[str], excerpts: list[Excerpt], history: list[str]) -> str:
    data = []
    if facts:
        data.append("Fact sheet:\n" + "\n\n".join(facts))
    if excerpts:
        data.append("Code excerpts:\n" + "\n\n".join(excerpt.render() for excerpt in excerpts))
    parts = [repo_data(redact_secrets("\n\n".join(data)))] if data else []
    if history:
        parts.append("Conversation so far:\n" + "\n".join(history))
    parts.append(f"Question: {question}")
    return "\n\n".join(parts)


def build_request(
    question: str, history: list[dict], facts: list[str], excerpts: list[Excerpt]
) -> tuple[LlmRequest, list[Excerpt]]:
    """The exact chat request and the excerpts that fitted."""

    question = question.strip()
    if not question:
        raise ValueError("Ask a question first.")
    budget = max_input_tokens() - estimate_tokens(CHAT_SYSTEM)
    turns = _history_lines(history)

    # (kind, index) in the order parts are kept.
    priority = [("excerpt", 0), ("fact", 0)]
    priority += [("turn", i) for i in reversed(range(max(0, len(turns) - 2), len(turns)))]
    priority += [("excerpt", i) for i in range(1, len(excerpts))]
    priority += [("fact", i) for i in range(1, len(facts))]
    priority += [("turn", i) for i in reversed(range(max(0, len(turns) - 2)))]

    chosen: dict[str, set[int]] = {"excerpt": set(), "fact": set(), "turn": set()}

    def prompt_with(selection: dict[str, set[int]]) -> str:
        return _render(
            question,
            [facts[i] for i in sorted(selection["fact"])],
            [excerpts[i] for i in sorted(selection["excerpt"])],
            [turns[i] for i in sorted(selection["turn"])],
        )

    if estimate_tokens(prompt_with(chosen)) > budget:
        raise TokenBudgetError(
            f"The question alone is over the limit of {max_input_tokens()} tokens "
            "(CODELENS_LLM_MAX_INPUT_TOKENS). Ask a shorter question."
        )
    for kind, index in priority:
        source = {"excerpt": excerpts, "fact": facts, "turn": turns}[kind]
        if index >= len(source):
            continue
        trial = {key: set(value) for key, value in chosen.items()}
        trial[kind].add(index)
        if estimate_tokens(prompt_with(trial)) <= budget:
            chosen = trial

    used = [excerpts[i] for i in sorted(chosen["excerpt"])]
    request = LlmRequest(CHAT_SYSTEM, prompt_with(chosen), min(MAX_OUTPUT["chat"], max_output_tokens()))
    return request, used


def run_chat_agent(request: LlmRequest) -> str:
    return call_llm(request.prompt, request.max_output, system=request.system)
