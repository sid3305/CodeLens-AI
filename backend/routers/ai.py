from fastapi import APIRouter, HTTPException, Query

from backend.schemas.ai import (
    SummaryResponse,
    ExplainRequest,
    ExplainResponse,
)
from backend.services.repository_service import (
    get_repository,
    get_saved_repository_summary,
    save_repository_summary,
)

from agents.repo_agent import run_repo_agent
from agents.explain_agent import run_explain_agent
from utils.file_handler import get_code_files
from utils.parser import read_file_content

from datetime import datetime, timezone


router = APIRouter(
    prefix="/api/repositories",
    tags=["AI Assistant"],
)



@router.get("/{repo_id}/summary", response_model=SummaryResponse)
def get_repository_summary(repo_id: str):
    """Retrieve a previously generated repository summary."""

    try:
        repository = get_repository(repo_id)
        saved_summary = get_saved_repository_summary(repo_id)

        if not saved_summary:
            raise HTTPException(
                status_code=404,
                detail="Repository summary has not been generated yet.",
            )

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

        repo_path = repository["path"]
        code_files = get_code_files(repo_path)

        if not code_files:
            raise ValueError(
                "No supported code files found in repository."
            )

        repository_content = ""

        for file_path in code_files:
            content = read_file_content(file_path)

            if content.startswith("Error reading file:"):
                continue

            repository_content += f"\n\nFILE: {file_path}\n{content}"

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
        raise HTTPException(
            status_code=502,
            detail=f"AI service error: {error}",
        )

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to generate repository summary.",
        )


@router.post("/{repo_id}/files/explain", response_model=ExplainResponse)
def explain_repository_file(repo_id: str, request: ExplainRequest):
    """Generate an AI-powered explanation for a specific file."""
    try:
        repository = get_repository(repo_id)
        repo_path = repository["path"]

        # Validate and resolve the file path
        from utils.security import is_sensitive_file
        from pathlib import Path

        requested_path = Path(request.file_path)
        if requested_path.is_absolute() or ".." in requested_path.parts:
            raise ValueError("Invalid file path.")

        file_path = (Path(repo_path) / requested_path).resolve()

        try:
            file_path.relative_to(Path(repo_path).resolve())
        except ValueError:
            raise ValueError("File is outside the repository.")

        if not file_path.is_file():
            raise ValueError("File not found.")

        if is_sensitive_file(file_path):
            raise ValueError("Sensitive files cannot be explained.")

        if file_path.stat().st_size > 1024 * 1024:
            raise ValueError("File exceeds the maximum allowed size.")

        content = read_file_content(str(file_path))
        if content.startswith("Error reading file:"):
            raise ValueError("Unable to read this file.")

        # Generate explanation using the explain agent
        explanation_text = run_explain_agent(content, str(file_path))

        return ExplainResponse(
            repository_id=repo_id,
            file_path=request.file_path,
            explanation=explanation_text,
            generated_at=datetime.now(timezone.utc).isoformat(),
            truncated=len(content) > 12000,
        )

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=f"AI service error: {error}")
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to explain file.")