
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import UploadFile

from utils.config import get_registry_file, get_upload_dir
from utils.file_handler import (
    MAX_ARCHIVE_SIZE,
    clone_github_repo,
    create_workspace,
    extract_zip,
    get_code_files,
    remove_tree,
)
from utils.parser import read_file_content
from utils.security import is_sensitive_file, resolve_within

_registry_lock = Lock()

# Workspaces are created as uuid4().hex directories by create_workspace().
_WORKSPACE_NAME = re.compile(r"[0-9a-f]{32}")


def _load_registry():
    """Load previously imported repositories."""

    registry_file = get_registry_file()

    if not registry_file.exists():
        return {}

    try:
        with registry_file.open("r", encoding="utf-8") as file:
            data = json.load(file)
            return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_registry(registry):
    """Persist repository metadata."""

    registry_file = get_registry_file()
    registry_file.parent.mkdir(parents=True, exist_ok=True)

    temporary_file = registry_file.with_suffix(".tmp")

    with temporary_file.open("w", encoding="utf-8") as file:
        json.dump(registry, file, indent=4)

    temporary_file.replace(registry_file)


def _register_repository(repo_id, name, source, repo_path, **metadata):
    """Save repository metadata (plus optional ref/focus_path/source_url)."""

    code_files = get_code_files(repo_path)

    if not code_files:
        raise ValueError(
            "No supported source files were found in this repository."
        )

    repository = {
        "id": repo_id,
        "name": name,
        "source": source,
        "path": str(Path(repo_path).resolve()),
        "file_count": len(code_files),
        "created_at": datetime.now(timezone.utc).isoformat(),
        **metadata,
    }

    with _registry_lock:
        registry = _load_registry()
        registry[repo_id] = repository
        _save_registry(registry)

    return repository


def list_repositories():
    """Return all registered repositories."""

    with _registry_lock:
        registry = _load_registry()

    valid_repositories = []

    for repository in registry.values():
        if Path(repository["path"]).is_dir():
            valid_repositories.append(repository)

    return valid_repositories


def get_repository(repo_id):
    """Retrieve one repository by its ID."""

    with _registry_lock:
        registry = _load_registry()

    repository = registry.get(repo_id)

    if not repository:
        raise ValueError("Repository not found.")

    repo_path = Path(repository["path"]).resolve()
    upload_root = get_upload_dir()

    try:
        repo_path.relative_to(upload_root)
    except ValueError:
        raise ValueError("Invalid repository location.")

    if not repo_path.is_dir():
        raise ValueError("Repository directory no longer exists.")

    return repository


def _detect_project_root(extract_path):
    """
    Detect an unnecessary single parent directory
    inside an extracted ZIP archive.
    """

    extract_path = Path(extract_path)

    items = list(extract_path.iterdir())

    # If the ZIP contains exactly one top-level directory
    # and no files at its root, use that directory.
    if (
        len(items) == 1
        and items[0].is_dir()
        and not items[0].is_symlink()
    ):
        return items[0]

    return extract_path


async def receive_zip_upload(upload: UploadFile) -> Path:
    """
    Validate and store an uploaded ZIP in a new workspace; returns the
    archive path. Extraction is separate so it can run as a job (B3).
    """

    if not upload.filename or Path(upload.filename).suffix.lower() != ".zip":
        raise ValueError("Please upload a valid ZIP archive.")

    workspace = Path(create_workspace())

    try:
        archive_content = await upload.read(MAX_ARCHIVE_SIZE + 1)

        if not archive_content:
            raise ValueError("Uploaded ZIP file is empty.")

        if len(archive_content) > MAX_ARCHIVE_SIZE:
            raise ValueError("ZIP archive exceeds the maximum allowed size.")

        archive_path = workspace / "repository_upload.zip"
        archive_path.write_bytes(archive_content)
        return archive_path

    except Exception:
        remove_tree(workspace)
        raise

    finally:
        await upload.close()


def register_zip_archive(archive_path: Path, *, check=None):
    """Extract a stored upload and register it; removes the workspace on failure or cancel."""

    archive_path = Path(archive_path)
    workspace = archive_path.parent

    try:
        if check:
            check()
        extracted_path = Path(extract_zip(str(archive_path)))
        if check:
            check()

        repo_path = _detect_project_root(extracted_path)

        archive_path.unlink(missing_ok=True)

        return _register_repository(
            repo_id=workspace.name,
            name=repo_path.name,
            source="zip",
            repo_path=repo_path,
        )

    except BaseException:
        remove_tree(workspace)
        raise


async def import_zip_repository(upload: UploadFile):
    """Import and extract a ZIP repository."""

    return register_zip_archive(await receive_zip_upload(upload))


def import_github_repository(repo_url, *, check=None):
    """Clone and register a GitHub repository. ``check`` may raise to cancel after cloning."""

    cloned = clone_github_repo(repo_url)
    repo_path = Path(cloned.path).resolve()
    workspace = repo_path.parent
    source = cloned.source

    try:
        if check:
            check()
        return _register_repository(
            repo_id=workspace.name,
            name=source.repo,
            source="github",
            repo_path=repo_path,
            ref=source.ref,
            focus_path=source.focus_path,
            source_url=source.url,
        )

    except BaseException:
        remove_tree(workspace)
        raise

def list_repository_files(repo_id):
    """Return repository files using relative paths."""

    repository = get_repository(repo_id)
    repo_path = Path(repository["path"])

    absolute_files = get_code_files(str(repo_path))

    files = []

    for file_path in absolute_files:
        path = Path(file_path)
        relative_path = path.relative_to(repo_path)

        files.append({
            "path": relative_path.as_posix(),
            "name": path.name,
            "extension": path.suffix.lower(),
        })

    return {
        "repository_id": repo_id,
        "total_files": len(files),
        "files": files,
    }


def get_file_content(repo_id, relative_path):
    """Safely retrieve a file from a repository."""

    repository = get_repository(repo_id)
    repo_path = Path(repository["path"]).resolve()

    file_path = resolve_within(repo_path, relative_path)

    if not file_path.is_file():
        raise ValueError("File not found.")

    if is_sensitive_file(file_path):
        raise ValueError("Sensitive files cannot be accessed.")

    if file_path.stat().st_size > 1024 * 1024:
        raise ValueError("File exceeds the maximum allowed size.")

    content = read_file_content(str(file_path))

    if content.startswith("Error reading file:"):
        raise ValueError("Unable to read this file.")

    return {
        "repository_id": repo_id,
        "path": file_path.relative_to(repo_path).as_posix(),
        "content": content,
    }

def delete_repository(repo_id: str):
    """Delete a repository's workspace and registry entry safely."""

    upload_root = get_upload_dir()
    workspace_path = upload_root / repo_id

    with _registry_lock:
        registry = _load_registry()
        repository = registry.get(repo_id)

        if not repository:
            raise ValueError("Repository not found.")

        # Only allow deletion of a direct child of uploads/.
        if (
            workspace_path.is_symlink()
            or workspace_path.resolve().parent != upload_root
        ):
            raise ValueError("Invalid repository workspace.")

        workspace_path = workspace_path.resolve()

        # Confirm the registered repository is inside this workspace.
        repo_path = Path(repository["path"]).resolve()

        try:
            repo_path.relative_to(workspace_path)
        except ValueError:
            raise ValueError("Invalid repository location.")

        # Delete the complete workspace, including analysis results.
        # remove_tree clears read-only flags (Git object files on Windows).
        if workspace_path.exists():
            remove_tree(workspace_path)

        # Remove the repository from the persistent registry.
        registry.pop(repo_id)
        _save_registry(registry)

    return {
        "message": "Repository deleted successfully.",
        "repository_id": repo_id,
    }


def get_saved_repository_summary(repo_id: str):
    """Retrieve a previously generated repository summary."""

    with _registry_lock:
        registry = _load_registry()

    repository = registry.get(repo_id)

    if not repository:
        raise ValueError("Repository not found.")

    return repository.get("ai_summary")


def save_repository_summary(repo_id: str, summary_data: dict):
    """Persist an AI-generated summary in the repository registry."""

    with _registry_lock:
        registry = _load_registry()

        if repo_id not in registry:
            raise ValueError("Repository not found.")

        registry[repo_id]["ai_summary"] = summary_data
        _save_registry(registry)

    return summary_data


def set_ai_consent(repo_id: str, enabled: bool) -> bool:
    """Record whether this repository's code may be sent to the AI provider (B6)."""

    with _registry_lock:
        registry = _load_registry()

        if repo_id not in registry:
            raise ValueError("Repository not found.")

        registry[repo_id]["ai_consent"] = bool(enabled)
        _save_registry(registry)

    return bool(enabled)


def has_ai_consent(repository: dict) -> bool:
    """Off unless the user turned it on for this repository."""

    return repository.get("ai_consent") is True


def sweep_orphan_workspaces():
    """
    Remove workspace directories that are not in the registry.

    These are left behind when a process is killed mid-import. Only
    directories named like a workspace id are considered, so nothing else
    in the upload directory is touched. Must run when no import is in
    progress (it is called once at application startup).
    """

    upload_root = get_upload_dir()

    if not upload_root.is_dir():
        return []

    removed = []

    with _registry_lock:
        registered = set(_load_registry())

        for entry in sorted(upload_root.iterdir()):
            if (
                entry.is_dir()
                and not entry.is_symlink()
                and _WORKSPACE_NAME.fullmatch(entry.name)
                and entry.name not in registered
            ):
                try:
                    remove_tree(entry)
                except OSError:
                    continue

                removed.append(entry.name)

    return removed
