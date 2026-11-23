
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from backend.schemas.repository import (
    GitHubImportRequest,
    RepositoryFilesResponse,
    RepositoryLinkPreview,
    RepositoryResponse,
)
from backend.services import dependency_service
from backend.services.repository_service import (
    delete_repository,
    get_file_content,
    import_github_repository,
    import_zip_repository,
    list_repositories,
    list_repository_files,
)
from utils.repo_url import parse_repository_url

router = APIRouter(
    prefix="/api/repositories",
    tags=["Repositories"],
)


@router.get("", response_model=list[RepositoryResponse])
def get_repositories():
    """List all imported repositories."""

    return list_repositories()


@router.post("/upload", response_model=RepositoryResponse)
async def upload_repository(file: Annotated[UploadFile, File()]):
    """Import a repository from a ZIP archive."""

    try:
        return await import_zip_repository(file)

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    except OSError:
        raise HTTPException(
            status_code=500,
            detail="Unable to import the uploaded repository.",
        )


@router.post("/github/parse", response_model=RepositoryLinkPreview)
def preview_github_link(request: GitHubImportRequest):
    """Validate and normalise a repository link without cloning it."""

    try:
        parsed = parse_repository_url(request.repo_url)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    return {
        "host": parsed.host,
        "owner": parsed.owner,
        "repo": parsed.repo,
        "ref": parsed.ref,
        "ref_kind": parsed.ref_kind,
        "focus_path": parsed.focus_path,
        "display": parsed.display,
        "url": parsed.url,
    }


@router.post("/github", response_model=RepositoryResponse)
def import_from_github(request: GitHubImportRequest):
    """Import a public GitHub repository."""

    try:
        return import_github_repository(request.repo_url)

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    # Clone failures. git's own message is not returned: it includes the
    # local destination path.
    except RuntimeError:
        raise HTTPException(
            status_code=502,
            detail="Unable to import the GitHub repository. Check the URL and try again.",
        )


@router.get(
    "/{repo_id}/files",
    response_model=RepositoryFilesResponse,
)
def get_repository_files(repo_id: str):
    """List supported source files in a repository."""

    try:
        return list_repository_files(repo_id)

    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.get("/{repo_id}/files/content")
def get_repository_file_content(
    repo_id: str,
    path: str = Query(..., description="Repository-relative file path"),
):
    """Retrieve the content of a repository file."""

    try:
        return get_file_content(repo_id, path)

    except ValueError as error:
        message = str(error)

        status_code = 403 if (
            "outside the repository" in message
            or "Sensitive" in message
            or "Invalid file path" in message
            or "Symbolic links" in message
        ) else 404

        raise HTTPException(status_code=status_code, detail=message)

@router.delete("/{repo_id}")
def remove_repository(repo_id: str):
    """Delete an imported repository and its workspace."""

    try:
        result = delete_repository(repo_id)
        dependency_service.forget(repo_id)
        return result

    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))

    except OSError:
        raise HTTPException(
            status_code=500,
            detail="Unable to delete the repository workspace.",
        )