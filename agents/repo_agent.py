
from utils.llm import call_llm
from prompts.prompts import REPOSITORY_SUMMARY_PROMPT
from utils.security import redact_secrets


MAX_REPOSITORY_CHARS = 30000


def run_repo_agent(repository_content):

    if not repository_content or not repository_content.strip():
        raise ValueError("Repository content is empty.")

    # Redact secrets before sending repository content to Groq.
    sanitized_content = redact_secrets(repository_content)

    truncated = len(sanitized_content) > MAX_REPOSITORY_CHARS

    sanitized_content = sanitized_content[:MAX_REPOSITORY_CHARS]

    prompt = REPOSITORY_SUMMARY_PROMPT.format(
        content=sanitized_content
    )

    response = call_llm(prompt, max_tokens=2048)

    if truncated:
        response += (
            "\n\nNote: Only a portion of the repository "
            "was included due to context limits."
        )

    return response
