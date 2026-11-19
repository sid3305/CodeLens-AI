
from fastapi import APIRouter, HTTPException

from backend.services.analysis_service import (
    analyze_repository,
    get_analysis_results,
)


router = APIRouter(
    prefix="/api/repositories",
    tags=["Repository Analysis"],
)


@router.post("/{repo_id}/analyze")
def run_repository_analysis(repo_id: str):
    """Run Ruff, Bandit, Semgrep and Gitleaks."""

    try:
        return analyze_repository(repo_id)

    except ValueError as error:
        message = str(error)

        status_code = 404 if "not found" in message.lower() else 400

        raise HTTPException(
            status_code=status_code,
            detail=message,
        )

    except RuntimeError as error:
        message = str(error)

        status_code = (
            409 if "currently running" in message.lower()
            else 500
        )

        raise HTTPException(
            status_code=status_code,
            detail=message,
        )

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Repository analysis failed unexpectedly.",
        )


@router.get("/{repo_id}/results")
def fetch_analysis_results(repo_id: str):
    """Retrieve the latest analysis results."""

    try:
        return get_analysis_results(repo_id)

    except ValueError as error:
        message = str(error)

        status_code = 404 if (
            "not found" in message.lower()
            or "no analysis results" in message.lower()
        ) else 400

        raise HTTPException(
            status_code=status_code,
            detail=message,
        )

    except RuntimeError:
        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve analysis results.",
        )
