"""A8 / SEC-01: secrets stay out of version control."""

import shutil
import subprocess

import pytest

from tests.conftest import PROJECT_ROOT


def _env_example():
    return (PROJECT_ROOT / ".env.example").read_text(encoding="utf-8")


def test_env_example_documents_required_keys_without_values():
    lines = {
        key.strip(): value.strip()
        for key, _, value in (
            line.partition("=")
            for line in _env_example().splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        )
    }

    assert "GROQ_API_KEY" in lines
    assert lines["GROQ_API_KEY"] == ""


@pytest.mark.parametrize(
    "path",
    [
        ".env",
        ".env.local",
        "uploads/x",
        ".review-scratch/x",
        "frontend/node_modules/x",
        ".coverage",
        "htmlcov/index.html",
    ],
)
def test_private_paths_are_gitignored(path):
    if not shutil.which("git") or not (PROJECT_ROOT / ".git").exists():
        pytest.skip("git repository not available")

    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "-q", path],
        cwd=PROJECT_ROOT,
        check=False,
    )

    assert result.returncode == 0, f"{path} is not ignored"


def test_env_example_is_not_ignored():
    if not shutil.which("git") or not (PROJECT_ROOT / ".git").exists():
        pytest.skip("git repository not available")

    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "-q", ".env.example"],
        cwd=PROJECT_ROOT,
        check=False,
    )

    assert result.returncode == 1
