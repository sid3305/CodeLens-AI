from prompts.prompts import MAX_OUTPUT, SUMMARY_SYSTEM, repo_data
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
    budget = max_input_tokens() - estimate_tokens(SUMMARY_SYSTEM)
    kept = list(sections)
    while True:
        prompt = repo_data(redact_secrets("\n\n".join(kept)))
        if estimate_tokens(prompt) <= budget or len(kept) == 1:
            break
        kept.pop()
    request = LlmRequest(SUMMARY_SYSTEM, prompt, min(MAX_OUTPUT["summary"], max_output_tokens()))
    return request, len(kept) < len(sections)


def run_repo_agent(sections: list[str]) -> str:
    request, dropped = build_request(sections)
    response = call_llm(request.prompt, request.max_output, system=request.system)
    return response + TRUNCATION_NOTE if dropped else response
