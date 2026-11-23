from prompts.prompts import CODE_EXPLANATION_PROMPT
from utils.llm import call_llm
from utils.security import prepare_content_for_llm
from utils.token_budget import (
    LlmRequest,
    estimate_tokens,
    max_input_tokens,
    max_output_tokens,
    trim_to_tokens,
)


def build_request(code_content: str, file_path: str | None = None) -> tuple[LlmRequest, bool]:
    """The exact explanation request, trimmed to the token budget; (request, trimmed)."""

    if not code_content or not code_content.strip():
        raise ValueError("Code content is empty.")
    sanitized = prepare_content_for_llm(file_path or "source_code.py", code_content)
    if sanitized is None:
        raise ValueError("This file contains sensitive information and cannot be sent to the AI.")
    overhead = estimate_tokens(CODE_EXPLANATION_PROMPT.format(content=""))
    content, trimmed = trim_to_tokens(sanitized, max_input_tokens() - overhead)
    return LlmRequest(system="", prompt=CODE_EXPLANATION_PROMPT.format(content=content), max_output=max_output_tokens()), trimmed


def run_explain_agent(code_content: str, file_path: str | None = None) -> str:
    request, _ = build_request(code_content, file_path)
    return call_llm(request.prompt, request.max_output, system=request.system or None)
