from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from agents import explain_agent, finding_agent, repo_agent
from agents.explain_agent import run_explain_agent
from agents.finding_agent import run_finding_agent
from agents.repo_agent import run_repo_agent
from backend.schemas.ai import (
    AiConsentRequest,
    AiConsentResponse,
    AiEstimateRequest,
    AiEstimateResponse,
    ExplainRequest,
    ExplainResponse,
    FindingAiRequest,
    FindingAiResponse,
    SummaryResponse,
)
from backend.services.ai_cache import cached_answer, fingerprint
from backend.services.ai_payloads import (
    explain_content,
    find_finding,
    finding_line_text,
    finding_window,
    summary_content,
)
from backend.services.fact_sheet import collect_facts, static_summary
from backend.services.repository_service import (
    get_repository,
    get_saved_repository_summary,
    has_ai_consent,
    save_repository_summary,
    set_ai_consent,
)
from utils.llm import (
    AINotConfiguredError,
    AIServiceError,
    effective_output_tokens,
    provider_info,
)
from utils.token_budget import LlmRequest, max_input_tokens

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

    finding = find_finding(repo_id, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found. Run an analysis first.")

    relative = finding.get("file") or ""
    window = finding_window(repository, finding)

    try:
        # Keyed by rule + path + the line's text, so re-running the analysis
        # (new finding ids, shifted lines elsewhere) keeps the answer.
        text, cached = cached_answer(
            repo_id,
            f"finding_{request.mode}",
            fingerprint(finding.get("rule_id"), relative, finding_line_text(repository, finding)),
            lambda: run_finding_agent(finding, request.mode, window),
            force=request.force,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        raise ai_error(error)

    return FindingAiResponse(
        repository_id=repo_id,
        finding_id=finding_id,
        mode=request.mode,
        text=text,
        cached=cached,
        generated_at=datetime.now(timezone.utc).isoformat(),
        sent={
            "file": relative,
            "start_line": window[1] if window else None,
            "end_line": window[2] if window else None,
        },
    )


def _estimate(request: LlmRequest) -> AiEstimateResponse:
    return AiEstimateResponse(
        input_tokens=request.input_tokens,
        output_tokens=effective_output_tokens(request.max_output),
        max_input_tokens=max_input_tokens(),
        within_budget=request.input_tokens <= max_input_tokens(),
    )


@router.post("/{repo_id}/ai/estimate", response_model=AiEstimateResponse)
def estimate_ai_request(repo_id: str, request: AiEstimateRequest):
    """Count what a task would send. Nothing is sent, so no consent is needed."""

    try:
        repository = get_repository(repo_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    try:
        if request.task == "summary":
            built, _ = repo_agent.build_request(summary_content(repository))
        elif request.task == "explain":
            content = explain_content(repository, request.file_path or "", request.start_line, request.end_line)
            built, _ = explain_agent.build_request(content, request.file_path)
        else:
            finding = find_finding(repo_id, request.finding_id or "")
            if finding is None:
                raise HTTPException(status_code=404, detail="Finding not found.")
            built = finding_agent.build_request(finding, request.mode, finding_window(repository, finding))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    return _estimate(built)


@router.get("/{repo_id}/ai/estimate/findings")
def estimate_findings(repo_id: str):
    """Input tokens per finding (explain; a fix request is the same size within a few tokens)."""

    try:
        repository = get_repository(repo_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    from backend.services.analysis_service import get_analysis_results

    findings = (get_analysis_results(repo_id) or {}).get("findings", [])
    counts = {
        item["id"]: finding_agent.build_request(item, "explain", finding_window(repository, item)).input_tokens
        for item in findings
    }
    return {"output_tokens": effective_output_tokens(None), "max_input_tokens": max_input_tokens(), "findings": counts}


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



@router.get("/{repo_id}/static-summary")
def get_static_summary(repo_id: str):
    """A summary written from the analysis facts with fixed sentences. No AI, no consent needed."""

    try:
        repository = get_repository(repo_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    return {
        "repository_id": repo_id,
        "markdown": static_summary(collect_facts(repo_id, repository)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/{repo_id}/summary", response_model=SummaryResponse | None)
def get_repository_summary(repo_id: str):
    """
    The saved repository summary, or null when none was generated yet
    (an empty state, not an error). Unknown repositories are 404.
    """

    try:
        repository = get_repository(repo_id)
        saved_summary = get_saved_repository_summary(repo_id)

        # An empty saved answer (from an earlier failure) counts as none.
        if not saved_summary or not (saved_summary.get("summary") or "").strip():
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

        content = summary_content(repository)
        built, trimmed = repo_agent.build_request(content)
        # Regenerate (force) always asks again; otherwise an identical fact
        # sheet reuses the cached answer.
        summary_text, _ = cached_answer(
            repo_id, "summary", fingerprint(built.system, built.prompt),
            lambda: run_repo_agent(content), force=force,
        )

        summary_data = {
            "summary": summary_text,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "truncated": trimmed,
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
        start, end = request.start_line, request.end_line
        content = explain_content(repository, request.file_path, start, end)
        built, trimmed = explain_agent.build_request(content, request.file_path)
        explanation_text, cached = cached_answer(
            repo_id, "explain", fingerprint(built.system, built.prompt),
            lambda: run_explain_agent(content, request.file_path), force=request.force,
        )

        return ExplainResponse(
            repository_id=repo_id,
            file_path=request.file_path,
            start_line=start,
            end_line=end,
            explanation=explanation_text,
            generated_at=datetime.now(timezone.utc).isoformat(),
            truncated=trimmed,
            cached=cached,
        )

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        raise ai_error(error)
