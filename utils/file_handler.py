
import fnmatch
import logging
import os
import re
import shutil
import subprocess
import sys
import uuid
import zipfile
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath

from utils.config import get_upload_dir
from utils.repo_url import RepositoryURL, parse_repository_url
from utils.security import is_link

logger = logging.getLogger(__name__)

# ---------------- CONFIGURATION ----------------

MAX_ARCHIVE_SIZE = 100 * 1024 * 1024       # 100 MB
MAX_EXTRACTED_SIZE = 500 * 1024 * 1024     # 500 MB
MAX_SINGLE_FILE_SIZE = 1 * 1024 * 1024     # 1 MB for AI scanning
MAX_ARCHIVE_ENTRIES = 10_000               # files + directories in a ZIP
MAX_REPOSITORY_FILES = 50_000              # files in a cloned repository

SUPPORTED_EXTENSIONS = {
    ".py", ".java", ".cpp", ".c", ".cs",
    ".go", ".rb", ".php",
    ".js", ".jsx", ".mjs", ".cjs",
    ".ts", ".tsx", ".mts", ".cts",
    ".html", ".css",
    ".json", ".yaml", ".yml", ".toml",
    ".md",
    ".sh", ".bat",
    ".sql"
}

IGNORED_FOLDERS = {
    "node_modules", "venv", ".venv", ".git",
    "__pycache__", "dist", "build",
    ".idea", ".next", ".pytest_cache",
    "coverage", ".tox"
}

SENSITIVE_FILENAMES = {
    ".env", ".env.local", ".env.production",
    "id_rsa", "id_ed25519",
    "credentials.json", "secrets.json",
    "service-account.json"
}


# ---------------- WORKSPACE ----------------

def ensure_upload_dir():
    get_upload_dir().mkdir(parents=True, exist_ok=True)


def create_workspace():
    """Create a unique workspace for every imported repository."""
    ensure_upload_dir()

    workspace = get_upload_dir() / uuid.uuid4().hex
    workspace.mkdir(parents=True, exist_ok=False)

    return workspace


# ---------------- PORTABLE NAMES ----------------

_WINDOWS_RESERVED_NAMES = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}

_WINDOWS_INVALID_CHARACTERS = set('<>:"|?*') | {chr(code) for code in range(32)}


def is_portable_name(name):
    """
    Return True when a single path component can be created on every
    supported platform (Windows is the most restrictive).

    Non-portable entries are skipped on all platforms so an archive
    produces the same file list wherever CodeLens AI runs.
    """

    if not name or name in {".", ".."}:
        return False

    if any(character in _WINDOWS_INVALID_CHARACTERS for character in name):
        return False

    if name[-1] in {" ", "."}:
        return False

    return name.split(".")[0].lower() not in _WINDOWS_RESERVED_NAMES


def remove_tree(path):
    """Delete a directory tree, clearing read-only flags (Windows .git files)."""

    def _make_writable_and_retry(function, target, _error):
        os.chmod(target, 0o700)
        function(target)

    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_make_writable_and_retry)
    else:  # pragma: no cover - Python 3.10/3.11
        shutil.rmtree(path, onerror=_make_writable_and_retry)


# ---------------- SECURE ZIP EXTRACTION ----------------

def extract_zip(zip_path):
    """
    Safely extract a ZIP repository.

    Protects against:
    - Path traversal
    - Symbolic links
    - Oversized archives
    - Excessive extracted content
    """

    zip_path = Path(zip_path).resolve()

    if not zip_path.exists():
        raise FileNotFoundError("ZIP file not found.")

    if zip_path.stat().st_size > MAX_ARCHIVE_SIZE:
        raise ValueError("ZIP file exceeds the 100 MB limit.")

    extract_folder = zip_path.parent / "repository"
    extract_folder.mkdir(parents=True, exist_ok=True)

    total_size = 0

    try:
        zip_ref = zipfile.ZipFile(zip_path, "r")
    except zipfile.BadZipFile:
        raise ValueError("The uploaded file is not a valid ZIP archive.")

    with zip_ref:

        entries = zip_ref.infolist()

        if len(entries) > MAX_ARCHIVE_ENTRIES:
            raise ValueError(
                f"ZIP contains too many entries ({len(entries):,}). "
                f"The limit is {MAX_ARCHIVE_ENTRIES:,}."
            )

        for info in entries:

            # Reject symbolic links.
            unix_mode = info.external_attr >> 16

            if (unix_mode & 0o170000) == 0o120000:
                raise ValueError("ZIP contains an unsafe symbolic link.")

            # ZIP paths should use forward slashes, but some Windows tools
            # write backslashes. Normalise before validating.
            member_path = PurePosixPath(info.filename.replace("\\", "/"))

            if (
                member_path.is_absolute()
                or ".." in member_path.parts
                or re.match(r"^[A-Za-z]:", info.filename)
            ):
                raise ValueError("ZIP contains an unsafe file path.")

            # Skip names that cannot be created on every platform.
            if not all(is_portable_name(part) for part in member_path.parts):
                continue

            destination = (extract_folder / Path(*member_path.parts)).resolve()

            if not destination.is_relative_to(extract_folder.resolve()):
                raise ValueError("ZIP path traversal detected.")

            total_size += info.file_size

            if total_size > MAX_EXTRACTED_SIZE:
                raise ValueError("Extracted repository exceeds the 500 MB limit.")

            if info.file_size > MAX_SINGLE_FILE_SIZE:
                continue

            if info.is_dir() or info.filename.endswith(("/", "\\")):
                destination.mkdir(parents=True, exist_ok=True)
                continue

            destination.parent.mkdir(parents=True, exist_ok=True)

            with zip_ref.open(info) as source, open(destination, "wb") as target:
                shutil.copyfileobj(source, target, 64 * 1024)

    return str(extract_folder)


# ---------------- GITHUB REPOSITORY ----------------

@dataclass(frozen=True)
class ClonedRepository:
    path: str
    source: RepositoryURL  # with the ref and focus path that were actually used


class _RefNotFound(Exception):
    pass


_PRIVATE_MARKERS = (
    "repository not found",
    "could not read username",
    "authentication failed",
    "terminal prompts disabled",
    "returned error: 401",
    "returned error: 403",
)
_REF_MARKERS = (
    "not found in upstream",
    "could not find remote branch",
    "couldn't find remote ref",
    "unadvertised object",
)


def clone_github_repo(repo_url):
    """
    Clone a public repository link (any form accepted by
    utils.repo_url.parse_repository_url) into an isolated workspace.

    Raises ValueError for links that are invalid, private or point at a
    missing branch, RuntimeError for other git failures.
    """

    source = parse_repository_url(repo_url)

    workspace = create_workspace()
    repo_folder = workspace / "repository"

    try:
        used = _clone(source, repo_folder)
        _remove_links(repo_folder)
        _enforce_repository_limits(repo_folder)
    except BaseException:
        remove_tree(workspace)
        raise

    return ClonedRepository(path=str(repo_folder), source=used)


def _clone(source, repo_folder):
    """Shallow clone of the requested ref; returns the source actually cloned."""

    if source.ref_kind == "commit":
        _run_git(["init", "-q", str(repo_folder)])
        _run_git(["-C", str(repo_folder), "fetch", "-q", "--depth", "1", "--", source.clone_url, source.ref])
        _run_git(["-C", str(repo_folder), "checkout", "-q", "--detach", "FETCH_HEAD"])
        return source

    if not source.ref:
        _run_git(["clone", "-q", "--depth", "1", "--", source.clone_url, str(repo_folder)])
        return source

    for ref, focus_path in source.ref_candidates:
        try:
            _run_git([
                "clone", "-q", "--depth", "1", "--single-branch",
                "--branch", ref,
                "--", source.clone_url, str(repo_folder),
            ])
        except _RefNotFound:
            if repo_folder.exists():
                remove_tree(repo_folder)
            continue
        return replace(source, ref=ref, focus_path=focus_path)

    raise ValueError(
        f"Branch or tag '{source.ref}' was not found in {source.owner}/{source.repo}."
    )


def _run_git(args):
    """
    Run git with an argv list (never a shell), no credential prompts and a
    timeout. Private repositories therefore fail fast instead of opening a
    credential dialog.
    """

    command = ["git", "-c", "credential.helper=", "-c", "core.askPass=", *args]
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}

    try:
        subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=180,
            env=env,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("Repository cloning timed out.")
    except FileNotFoundError:
        raise RuntimeError("Git is not installed or is not available in your system PATH.")
    except subprocess.CalledProcessError as error:
        stderr = (error.stderr or "").strip()
        lowered = stderr.lower()
        if any(marker in lowered for marker in _PRIVATE_MARKERS):
            raise ValueError(
                "Repository not found or private. Only public repositories can be "
                "imported; check the link and that the repository is public."
            ) from None
        if any(marker in lowered for marker in _REF_MARKERS):
            raise _RefNotFound(stderr) from None
        logger.warning("git failed: %s", stderr or error)
        raise RuntimeError("Git could not clone the repository.") from None


def _remove_links(folder):
    """Delete symlinks and junctions from a clone without touching their targets."""

    for root, dirs, files in os.walk(folder):
        for name in [*dirs, *files]:
            path = Path(root) / name
            if not is_link(path):
                continue
            if name in dirs:
                dirs.remove(name)
            # rmdir/unlink remove the link itself, never what it points to.
            if path.is_dir() and not path.is_symlink():
                os.rmdir(path)
            else:
                os.unlink(path)


def _enforce_repository_limits(folder):
    """Reject cloned repositories that exceed the size or file-count limits."""

    total_size = 0
    file_count = 0

    for root, _dirs, files in os.walk(folder):
        for filename in files:
            file_count += 1

            try:
                total_size += (Path(root) / filename).lstat().st_size
            except OSError:
                continue

            if total_size > MAX_EXTRACTED_SIZE:
                raise ValueError(
                    "Repository exceeds the maximum size of "
                    f"{MAX_EXTRACTED_SIZE // (1024 * 1024)} MB."
                )

            if file_count > MAX_REPOSITORY_FILES:
                raise ValueError(
                    f"Repository has more than {MAX_REPOSITORY_FILES:,} files."
                )


# ---------------- REPOSITORY FILE DISCOVERY ----------------

def get_code_files(folder_path, include_patterns=()):
    """
    Recursively collect supported text/code files.

    ``include_patterns`` are extra file-name globs (e.g. "requirements*.txt")
    accepted even though their extension is not a source extension.

    Skips:
    - Unnecessary directories
    - Sensitive files
    - Oversized files
    - Binary files
    """

    code_files = []
    folder_path = Path(folder_path).resolve()

    for root, dirs, files in os.walk(folder_path):

        # Never descend into symlinked or junctioned directories (SEC-07).
        dirs[:] = [
            d for d in dirs
            if d.lower() not in IGNORED_FOLDERS and not is_link(Path(root) / d)
        ]

        for filename in files:

            file_path = Path(root) / filename

            if filename.lower() in SENSITIVE_FILENAMES or is_link(file_path):
                continue

            if filename.lower().startswith(".env"):
                continue

            if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS and not any(
                fnmatch.fnmatch(filename.lower(), pattern) for pattern in include_patterns
            ):
                continue

            try:
                if file_path.stat().st_size > MAX_SINGLE_FILE_SIZE:
                    continue

                # Basic binary-file detection.
                with open(file_path, "rb") as f:
                    sample = f.read(8192)

                if b"\x00" in sample:
                    continue

                code_files.append(str(file_path))

            except (OSError, PermissionError):
                continue

    return sorted(code_files)
