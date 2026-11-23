from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from agents.explain_agent import run_explain_agent
from agents.finding_agent import code_window, run_finding_agent
from agents.repo_agent import run_repo_agent
from backend.schemas.ai import (
    MAX_SELECTION_LINES,
    AiConsentRequest,
    AiConsentResponse,
    ExplainRequest,
    ExplainResponse,
    FindingAiRequest,
    FindingAiResponse,
    SummaryResponse,
)
from backend.services.analysis_service import get_analysis_results
from backend.services.repository_service import (
    get_repository,
    get_saved_repository_summary,
    has_ai_consent,
    save_repository_summary,
    set_ai_consent,
)
from utils.file_handler import get_code_files
from utils.llm import AINotConfiguredError, AIServiceError, provider_info
from utils.parser import read_file_content
from utils.security import is_sensitive_file, prepare_content_for_llm, resolve_within

router = APIRouter(
    prefix="/api/repositories",
    tags=["AI Assistant"],
)


def _consent_response(repo_id: str, enabled: bool) -> AiConsentResponse:
    return AiConsentResponse(repository_id=repo_id, enabled=enabled, **provider_info())


def require_ai_consent(repository: dict) -> None:
    """No code leaves the machine until the user allowed it for this repository (B6)."""

    if not has_ai_consent(repository):
        provider = provider_info()["provider"]
        raise HTTPException(
            status_code=403,
            detail=f"AI is off for this repository. Turn it on to send code to {provider}.",
        )


def ai_error(error: Exception) -> HTTPException:
    """Map AI failures to clean responses: never raw provider text or local paths."""

    if isinstance(error, AINotConfiguredError):
        return HTTPException(status_code=503, detail=str(error))
    if isinstance(error, AIServiceError):
        return HTTPException(status_code=502, detail=str(error))
    return HTTPException(status_code=502, detail="The AI request failed. Try again later.")


@router.post("/{repo_id}/findings/{finding_id}/ai", response_model=FindingAiResponse)
def finding_ai(repo_id: str, finding_id: str, request: FindingAiRequest):
    """
    B5: explain a finding or suggest a fix. Sends the finding, its
    repository-relative path and at most 21 redacted lines around it.
    """

    try:
        repository = get_repository(repo_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))

    require_ai_consent(repository)

    results = get_analysis_results(repo_id)
    finding = next((item for item in (results or {}).get("findings", []) if item.get("id") == finding_id), None)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found. Run an analysis first.")

    relative = finding.get("file") or ""
    window = None
    # Sensitive files: the finding is explained without their code.
    if relative and not is_sensitive_file(relative):
        try:
            path = resolve_within(repository["path"], relative)
            if path.is_file() and path.stat().st_size <= 1024 * 1024:
                content = read_file_content(str(path))
                if not content.startswith("Error reading file:"):
                    window = code_window(content, finding.get("line"))
        except ValueError:
            window = None

    try:
        text = run_finding_agent(finding, request.mode, window)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        raise ai_error(error)

    return FindingAiResponse(
        repository_id=repo_id,
        finding_id=finding_id,
        mode=request.mode,
        text=text,
        generated_at=datetime.now(timezone.utc).isoformat(),
        sent={
            "file": relative,
            "start_line": window[1] if window else None,
            "end_line": window[2] if window else None,
        },
    )


@router.get("/{repo_id}/ai-consent", response_model=AiConsentResponse)
def get_ai_consent(repo_id: str):
    try:
        repository = get_repository(repo_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    return _consent_response(repo_id, has_ai_consent(repository))


@router.put("/{repo_id}/ai-consent", response_model=AiConsentResponse)
def update_ai_consent(repo_id: str, request: AiConsentRequest):
    try:
        get_repository(repo_id)
        enabled = set_ai_consent(repo_id, request.enabled)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    return _consent_response(repo_id, enabled)



@router.get("/{repo_id}/summary", response_model=SummaryResponse | None)
def get_repository_summary(repo_id: str):
    """
    The saved repository summary, or null when none was generated yet
    (an empty state, not an error). Unknown repositories are 404.
    """

    try:
        repository = get_repository(repo_id)
        saved_summary = get_saved_repository_summary(repo_id)

        if not saved_summary:
            return None

        return SummaryResponse(
            repository_id=repo_id,
            repository_name=repository["name"],
            summary=saved_summary["summary"],
            generated_at=saved_summary["generated_at"],
            truncated=saved_summary.get("truncated", False),
        )

    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.post("/{repo_id}/summary", response_model=SummaryResponse)
def generate_repository_summary(
    repo_id: str,
    force: bool = Query(
        False,
        description="Regenerate even if a saved summary exists.",
    ),
):
    """Generate and save an AI-powered repository summary."""

    try:
        repository = get_repository(repo_id)

        # Reuse an existing summary unless a regeneration was requested.
        saved_summary = None if force else get_saved_repository_summary(repo_id)

        if saved_summary:
            return SummaryResponse(
                repository_id=repo_id,
                repository_name=repository["name"],
                summary=saved_summary["summary"],
                generated_at=saved_summary["generated_at"],
                truncated=saved_summary.get("truncated", False),
            )

        require_ai_consent(repository)

        repo_path = repository["path"]
        repo_root = Path(repo_path).resolve()
        code_files = get_code_files(repo_root)

        if not code_files:
            raise ValueError(
                "No supported code files found in repository."
            )

        repository_content = ""

        for file_path in code_files:
            content = read_file_content(file_path)

            if content.startswith("Error reading file:"):
                continue

            # Repository-relative path: the prompt must not reveal where the
            # repository is stored on this machine.
            relative = Path(file_path).relative_to(repo_root).as_posix()
            # Sensitive files are skipped entirely; the rest is redacted.
            safe = prepare_content_for_llm(relative, content)
            if safe is None:
                continue
            repository_content += f"\n\nFILE: {relative}\n{safe}"

        if not repository_content.strip():
            raise ValueError("No readable code content found.")

        summary_text = run_repo_agent(repository_content)

        summary_data = {
            "summary": summary_text,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "truncated": len(repository_content) > 30000,
        }

        save_repository_summary(repo_id, summary_data)

        return SummaryResponse(
            repository_id=repo_id,
            repository_name=repository["name"],
            **summary_data,
        )

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    except RuntimeError as error:
        raise ai_error(error)



@router.post("/{repo_id}/files/explain", response_model=ExplainResponse)
def explain_repository_file(repo_id: str, request: ExplainRequest):
    """Generate an AI-powered explanation for a specific file."""
    try:
        repository = get_repository(repo_id)
        require_ai_consent(repository)
        repo_path = repository["path"]

        # Refuses traversal, absolute paths and symlinks/junctions (SEC-07).
        file_path = resolve_within(repo_path, request.file_path)

        if not file_path.is_file():
            raise ValueError("File not found.")

        if is_sensitive_file(file_path):
            raise ValueError("Sensitive files cannot be explained.")

        if file_path.stat().st_size > 1024 * 1024:
            raise ValueError("File exceeds the maximum allowed size.")

        content = read_file_content(str(file_path))
        if content.startswith("Error reading file:"):
            raise ValueError("Unable to read this file.")

        # C5: "Explain selection" sends only the selected lines.
        start, end = request.start_line, request.end_line
        if (start is None) != (end is None):
            raise ValueError("Give both the first and the last selected line.")
        if start is not None:
            lines = content.splitlines()
            if end < start or end > len(lines):
                raise ValueError("The selected lines are not in this file.")
            if end - start + 1 > MAX_SELECTION_LINES:
                raise ValueError(f"Select at most {MAX_SELECTION_LINES} lines.")
            content = "\n".join(lines[start - 1:end])

        # Generate explanation using the explain agent
        explanation_text = run_explain_agent(content, str(file_path))

        return ExplainResponse(
            repository_id=repo_id,
            file_path=request.file_path,
            start_line=start,
            end_line=end,
            explanation=explanation_text,
            generated_at=datetime.now(timezone.utc).isoformat(),
            truncated=len(content) > 12000,
        )

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        raise ai_error(error)
