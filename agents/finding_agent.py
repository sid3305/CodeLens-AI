"""
B5: explain a finding or suggest a fix. Sends only the rule id, the
analyzer's message, the repository-relative path and at most 11 redacted
lines around the finding, inside <repo_data> (untrusted data).
"""

from prompts.prompts import (
    FINDING_EXPLAIN_SYSTEM,
    FINDING_FIX_SYSTEM,
    MAX_OUTPUT,
    repo_data,
)
from utils.llm import call_llm
from utils.security import redact_secrets
from utils.token_budget import LlmRequest, max_output_tokens

WINDOW_LINES = 5
MAX_WINDOW_CHARS = 1500
SYSTEMS = {"explain": FINDING_EXPLAIN_SYSTEM, "fix": FINDING_FIX_SYSTEM}


def code_window(content: str, line: int | None) -> tuple[str, int, int] | None:
    """Lines line-5 .. line+5 (1-based, clamped, at most 11), capped in size."""

    if not line or line < 1:
        return None
    lines = content.splitlines()
    if line > len(lines):
        return None
    start = max(1, line - WINDOW_LINES)
    end = min(len(lines), line + WINDOW_LINES)
    numbered = "\n".join(f"{number:>5}  {lines[number - 1]}" for number in range(start, end + 1))
    return numbered[:MAX_WINDOW_CHARS], start, end


def build_request(finding: dict, mode: str, window: tuple[str, int, int] | None) -> LlmRequest:
    """The exact request for this finding (used to estimate and to send)."""

    if mode not in SYSTEMS:
        raise ValueError("Unknown request.")

    location = finding.get("file") or "unknown file"
    if finding.get("line"):
        location += f":{finding['line']}"
    message = finding.get("description") or ""
    title = finding.get("title") or ""
    if title and title not in message:
        message = f"{title}. {message}".strip()

    parts = [f"Rule: {finding.get('rule_id') or 'not specified'}", f"Message: {message}", f"Location: {location}"]
    if window:
        text, start, end = window
        parts.append(f"Lines {start}-{end}:\n{text}")
    else:
        parts.append("Code not included (sensitive file, or no line reported).")

    key = "finding_explain" if mode == "explain" else "finding_fix"
    return LlmRequest(SYSTEMS[mode], repo_data(redact_secrets("\n".join(parts))), min(MAX_OUTPUT[key], max_output_tokens()))


def run_finding_agent(finding: dict, mode: str, window: tuple[str, int, int] | None) -> str:
    request = build_request(finding, mode, window)
    return call_llm(request.prompt, request.max_output, system=request.system)
