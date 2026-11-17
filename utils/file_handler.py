
import os
import re
import uuid
import zipfile
import subprocess

from pathlib import Path, PurePosixPath
from urllib.parse import urlparse


# ---------------- CONFIGURATION ----------------

UPLOAD_DIR = Path("uploads")

MAX_ARCHIVE_SIZE = 100 * 1024 * 1024       # 100 MB
MAX_EXTRACTED_SIZE = 500 * 1024 * 1024     # 500 MB
MAX_SINGLE_FILE_SIZE = 1 * 1024 * 1024     # 1 MB for AI scanning

SUPPORTED_EXTENSIONS = {
    ".py", ".java", ".cpp", ".c", ".cs",
    ".go", ".rb", ".php",
    ".js", ".jsx", ".ts", ".tsx",
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
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def create_workspace():
    """Create a unique workspace for every imported repository."""
    ensure_upload_dir()

    workspace = UPLOAD_DIR / uuid.uuid4().hex
    workspace.mkdir(parents=True, exist_ok=False)

    return workspace


# ---------------- FILE UPLOAD ----------------

def save_uploaded_file(uploaded_file):
    """Save an uploaded file in its own workspace."""

    workspace = create_workspace()

    # Never trust the uploaded filename as a filesystem path.
    filename = Path(uploaded_file.name).name

    if not filename or filename in {".", ".."}:
        raise ValueError("Invalid uploaded filename.")

    file_path = workspace / filename

    if file_path.suffix.lower() == ".zip":
        if uploaded_file.size > MAX_ARCHIVE_SIZE:
            raise ValueError("ZIP file exceeds the 100 MB upload limit.")

    with open(file_path, "wb") as f:
        f.write(uploaded_file.getbuffer())

    return str(file_path)


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

    with zipfile.ZipFile(zip_path, "r") as zip_ref:

        for info in zip_ref.infolist():

            # Reject symbolic links.
            unix_mode = info.external_attr >> 16

            if (unix_mode & 0o170000) == 0o120000:
                raise ValueError("ZIP contains an unsafe symbolic link.")

            # ZIP paths use forward slashes.
            member_path = PurePosixPath(info.filename)

            if member_path.is_absolute() or ".." in member_path.parts:
                raise ValueError("ZIP contains an unsafe file path.")

            destination = (extract_folder / Path(*member_path.parts)).resolve()

            if not destination.is_relative_to(extract_folder.resolve()):
                raise ValueError("ZIP path traversal detected.")

            total_size += info.file_size

            if total_size > MAX_EXTRACTED_SIZE:
                raise ValueError("Extracted repository exceeds the 500 MB limit.")

            if info.file_size > MAX_SINGLE_FILE_SIZE:
                continue

            if info.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue

            destination.parent.mkdir(parents=True, exist_ok=True)

            with zip_ref.open(info) as source:
                with open(destination, "wb") as target:
                    while True:
                        chunk = source.read(64 * 1024)

                        if not chunk:
                            break

                        target.write(chunk)

    return str(extract_folder)


# ---------------- GITHUB REPOSITORY ----------------

def clone_github_repo(repo_url):
    """
    Clone a public GitHub repository into an isolated workspace.
    """

    parsed = urlparse(repo_url.strip())

    if parsed.scheme != "https" or parsed.hostname != "github.com":
        raise ValueError("Please provide a valid HTTPS GitHub repository URL.")

    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("GitHub URL must not contain credentials or extra parameters.")

    parts = [part for part in parsed.path.strip("/").split("/") if part]

    if len(parts) != 2:
        raise ValueError("Use the format: https://github.com/owner/repository")

    owner, repository = parts
    repository = repository.removesuffix(".git")

    if not re.fullmatch(r"[A-Za-z0-9_.-]+", owner):
        raise ValueError("Invalid GitHub owner name.")

    if not re.fullmatch(r"[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid repository name.")

    workspace = create_workspace()
    repo_folder = workspace / "repository"

    clone_url = f"https://github.com/{owner}/{repository}.git"

    try:
        subprocess.run(
            [
                "git",
                "clone",
                "--depth", "1",
                "--",
                clone_url,
                str(repo_folder)
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=180
        )

    except subprocess.TimeoutExpired:
        raise RuntimeError("Repository cloning timed out.")

    except subprocess.CalledProcessError as e:
        error = e.stderr.strip() if e.stderr else "Unknown Git error."
        raise RuntimeError(f"GitHub clone failed: {error}")

    except FileNotFoundError:
        raise RuntimeError(
            "Git is not installed or is not available in your system PATH."
        )

    return str(repo_folder)


# ---------------- REPOSITORY FILE DISCOVERY ----------------

def get_code_files(folder_path):
    """
    Recursively collect supported text/code files.

    Skips:
    - Unnecessary directories
    - Sensitive files
    - Oversized files
    - Binary files
    """

    code_files = []
    folder_path = Path(folder_path).resolve()

    for root, dirs, files in os.walk(folder_path):

        dirs[:] = [
            d for d in dirs
            if d.lower() not in IGNORED_FOLDERS
        ]

        for filename in files:

            file_path = Path(root) / filename

            if filename.lower() in SENSITIVE_FILENAMES:
                continue

            if filename.lower().startswith(".env"):
                continue

            if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
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
