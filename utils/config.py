"""
Runtime configuration.

Settings are read from the environment (and the project's .env file) each
time they are requested, so they never depend on the process working
directory or on import order.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Load the project's .env regardless of where the server was started from.
# Existing environment variables take precedence.
load_dotenv(PROJECT_ROOT / ".env", override=False)


def get_upload_dir() -> Path:
    """
    Directory that stores imported repositories and the repository registry.

    Configured with CODELENS_UPLOAD_DIR. Relative values are resolved against
    the project root. Defaults to <project root>/uploads.
    """

    configured = os.getenv("CODELENS_UPLOAD_DIR", "").strip()

    if not configured:
        return (PROJECT_ROOT / "uploads").resolve()

    path = Path(configured).expanduser()

    if not path.is_absolute():
        path = PROJECT_ROOT / path

    return path.resolve()


def get_registry_file() -> Path:
    """JSON file holding metadata for every imported repository."""

    return get_upload_dir() / ".codelens_repositories.json"
