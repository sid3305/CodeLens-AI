"""
Background jobs (B3). Start a job, then poll GET /api/jobs/{id} for status
and progress; POST /api/jobs/{id}/cancel stops it at its next step.
"""

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from backend.services.analysis_service import analyze_repository
from backend.services.dependency_service import get_dependency_report
from backend.services.jobs import UNEXPECTED_ERROR, JobContext, jobs
from backend.services.repository_service import (
    get_repository,
    import_github_repository,
    receive_zip_upload,
    register_zip_archive,
)
from utils.repo_url import parse_repository_url

router = APIRouter(prefix="/api/jobs", tags=["Jobs"])

IMPORT_FAILED = "Unable to import the repository. Check the link and try again."


class RepositoryJobRequest(BaseModel):
    repository_id: str


class DependenciesJobRequest(RepositoryJobRequest):
    refresh: bool = False


class LinkImportRequest(BaseModel):
    repo_url: str


def _known_repository(repo_id: str) -> None:
    try:
        get_repository(repo_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


def _runtime_message(error: Exception, fallback: str) -> str | None:
    """RuntimeErrors carry internal detail (git output, paths): show a fixed message."""

    if isinstance(error, RuntimeError):
        text = str(error)
        return text if "currently running" in text else fallback
    return None


@router.get("")
def list_jobs(repository_id: str | None = None, active: bool | None = Query(None)):
    return [job.to_dict() for job in jobs.list(repository_id=repository_id, active=active)]


@router.get("/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.to_dict()


@router.post("/{job_id}/cancel")
def cancel_job(job_id: str):
    job = jobs.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.to_dict()


@router.post("/analysis", status_code=202)
def start_analysis(request: RepositoryJobRequest):
    repo_id = request.repository_id
    _known_repository(repo_id)

    def work(ctx: JobContext):
        def on_progress(index: int, total: int, tool: str) -> None:
            ctx.progress(index / total, f"Running {tool} ({index + 1} of {total})")

        return analyze_repository(repo_id, on_progress=on_progress)

    job = jobs.submit("analysis", repo_id, work, on_error=lambda e: _runtime_message(e, UNEXPECTED_ERROR))
    return job.to_dict()


@router.post("/dependencies", status_code=202)
def start_dependencies(request: DependenciesJobRequest):
    repo_id = request.repository_id
    _known_repository(repo_id)

    def work(ctx: JobContext):
        ctx.progress(None, "Recomputing imports" if request.refresh else "Resolving imports")
        get_dependency_report(repo_id, refresh=request.refresh)
        # The report itself is read from GET .../dependencies (it can be large).
        return {"repository_id": repo_id}

    job = jobs.submit("dependencies", repo_id, work, on_error=lambda e: _runtime_message(e, UNEXPECTED_ERROR))
    return job.to_dict()


@router.post("/import/link", status_code=202)
def start_link_import(request: LinkImportRequest):
    # Invalid links are refused before any job exists.
    try:
        parsed = parse_repository_url(request.repo_url)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    def work(ctx: JobContext):
        ctx.progress(None, f"Cloning {parsed.display}")
        repository = import_github_repository(request.repo_url, check=ctx.check)
        ctx.set_repository(repository["id"])
        return repository

    job = jobs.submit("import", None, work, on_error=lambda e: _runtime_message(e, IMPORT_FAILED))
    return job.to_dict()


@router.post("/import/zip", status_code=202)
async def start_zip_import(file: Annotated[UploadFile, File()]):
    # The upload is received and validated in the request; extraction is the job.
    try:
        archive = await receive_zip_upload(file)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except OSError:
        raise HTTPException(status_code=500, detail="Unable to store the uploaded archive.")

    def work(ctx: JobContext):
        ctx.progress(None, "Extracting the archive")
        repository = register_zip_archive(archive, check=ctx.check)
        ctx.set_repository(repository["id"])
        return repository

    job = jobs.submit("import", None, work, on_error=lambda e: _runtime_message(e, IMPORT_FAILED))
    return job.to_dict()
