
from prompts.prompts import CODE_EXPLANATION_PROMPT
from utils.llm import call_llm
from utils.security import prepare_content_for_llm

MAX_FILE_CHARS = 12000


def run_explain_agent(code_content, file_path=None):

    if not code_content or not code_content.strip():
        raise ValueError("Code content is empty.")

    # Exclude sensitive files and redact detected secrets.
    sanitized_content = prepare_content_for_llm(
        file_path or "source_code.py",
        code_content
    )

    if sanitized_content is None:
        raise ValueError(
            "This file contains sensitive information and cannot be sent to the AI."
        )

    sanitized_content = sanitized_content[:MAX_FILE_CHARS]

    prompt = CODE_EXPLANATION_PROMPT.format(
        content=sanitized_content
    )

    response = call_llm(prompt, max_tokens=2048)

    return response
