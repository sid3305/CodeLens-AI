from prompts.prompts import REPOSITORY_SUMMARY_PROMPT
from utils.llm import call_llm
from utils.security import redact_secrets
from utils.token_budget import (
    LlmRequest,
    estimate_tokens,
    max_input_tokens,
    max_output_tokens,
    trim_to_tokens,
)

TRUNCATION_NOTE = "\n\nNote: Only a portion of the repository was included due to context limits."


def build_request(repository_content: str) -> tuple[LlmRequest, bool]:
    """The exact summary request, trimmed to the token budget; (request, trimmed)."""

    if not repository_content or not repository_content.strip():
        raise ValueError("Repository content is empty.")
    overhead = estimate_tokens(REPOSITORY_SUMMARY_PROMPT.format(content=""))
    content, trimmed = trim_to_tokens(redact_secrets(repository_content), max_input_tokens() - overhead)
    return LlmRequest(system="", prompt=REPOSITORY_SUMMARY_PROMPT.format(content=content), max_output=max_output_tokens()), trimmed


def run_repo_agent(repository_content: str) -> str:
    request, trimmed = build_request(repository_content)
    response = call_llm(request.prompt, request.max_output, system=request.system or None)
    return response + TRUNCATION_NOTE if trimmed else response
