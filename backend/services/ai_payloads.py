"""
What each AI task sends, built from a repository. Shared by the AI routes
(which send it) and the estimate endpoints (which only count it), so the
notice always describes the real payload.
"""


from agents.finding_agent import code_window
from backend.schemas.ai import MAX_SELECTION_LINES
from backend.services.analysis_service import get_analysis_results
from backend.services.fact_sheet import collect_facts, fact_sections
from utils.parser import read_file_content
from utils.security import is_sensitive_file, resolve_within

MAX_FILE_BYTES = 1024 * 1024


def summary_content(repository: dict) -> list[str]:
    """The fact sheet (no raw source): sections in priority order."""

    return fact_sections(collect_facts(repository["id"], repository), repository)


def explain_content(repository: dict, relative: str, start: int | None, end: int | None) -> str:
    """The file, or only lines start..end of it (validated)."""

    # Refuses traversal, absolute paths and symlinks/junctions (SEC-07).
    file_path = resolve_within(repository["path"], relative)
    if not file_path.is_file():
        raise ValueError("File not found.")
    if is_sensitive_file(file_path):
        raise ValueError("Sensitive files cannot be explained.")
    if file_path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("File exceeds the maximum allowed size.")
    content = read_file_content(str(file_path))
    if content.startswith("Error reading file:"):
        raise ValueError("Unable to read this file.")

    if (start is None) != (end is None):
        raise ValueError("Give both the first and the last selected line.")
    if start is not None:
        lines = content.splitlines()
        if end < start or end > len(lines):
            raise ValueError("The selected lines are not in this file.")
        if end - start + 1 > MAX_SELECTION_LINES:
            raise ValueError(f"Select at most {MAX_SELECTION_LINES} lines.")
        content = "\n".join(lines[start - 1:end])
    return content


def find_finding(repo_id: str, finding_id: str) -> dict | None:
    results = get_analysis_results(repo_id)
    return next((item for item in (results or {}).get("findings", []) if item.get("id") == finding_id), None)


def finding_window(repository: dict, finding: dict) -> tuple[str, int, int] | None:
    """A few lines around the finding; never from sensitive files."""

    relative = finding.get("file") or ""
    if not relative or is_sensitive_file(relative):
        return None
    try:
        path = resolve_within(repository["path"], relative)
    except ValueError:
        return None
    if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
        return None
    content = read_file_content(str(path))
    if content.startswith("Error reading file:"):
        return None
    return code_window(content, finding.get("line"))
