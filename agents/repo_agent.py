from prompts.prompts import REPOSITORY_SUMMARY_PROMPT
from utils.llm import call_llm
from utils.security import redact_secrets
from utils.token_budget import (
    LlmRequest,
    estimate_tokens,
    max_input_tokens,
    max_output_tokens,
)

TRUNCATION_NOTE = "\n\nNote: Only a portion of the repository was included due to context limits."


def build_request(sections: list[str]) -> tuple[LlmRequest, bool]:
    """
    The summary request from fact-sheet sections (highest priority first),
    dropping sections from the bottom until it fits; (request, dropped any).
    """

    if not sections or not any(section.strip() for section in sections):
        raise ValueError("Repository content is empty.")
    kept = list(sections)
    while True:
        prompt = REPOSITORY_SUMMARY_PROMPT.format(content=redact_secrets("\n\n".join(kept)))
        if estimate_tokens(prompt) <= max_input_tokens() or len(kept) == 1:
            break
        kept.pop()
    return LlmRequest(system="", prompt=prompt, max_output=max_output_tokens()), len(kept) < len(sections)


def run_repo_agent(sections: list[str]) -> str:
    request, dropped = build_request(sections)
    response = call_llm(request.prompt, request.max_output, system=request.system or None)
    return response + TRUNCATION_NOTE if dropped else response
