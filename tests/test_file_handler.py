"""ZIP extraction, GitHub URL validation and file discovery (utils/file_handler.py)."""

import subprocess
import zipfile
from pathlib import Path

import pytest

from tests.helpers import make_zip
from utils import file_handler
from utils.file_handler import (
    clone_github_repo,
    extract_zip,
    get_code_files,
    is_portable_name,
)


def _archive(tmp_path, files=None, *, build=None):
    path = tmp_path / "upload.zip"
    if build:
        with zipfile.ZipFile(path, "w") as archive:
            build(archive)
    else:
        path.write_bytes(make_zip(files))
    return path


# --- extract_zip -------------------------------------------------------------


def test_extracts_nested_files(tmp_path):
    archive = _archive(tmp_path, {"pkg/a.py": "a = 1", "pkg/sub/b.py": "b = 2"})

    root = Path(extract_zip(archive))

    assert (root / "pkg" / "a.py").read_text() == "a = 1"
    assert (root / "pkg" / "sub" / "b.py").read_text() == "b = 2"


@pytest.mark.parametrize(
    "member",
    ["../evil.py", "a/../../evil.py", "/abs/evil.py", "C:/evil.py", "C:evil.py"],
)
def test_rejects_unsafe_paths(tmp_path, member):
    archive = _archive(tmp_path, {member: "x"})

    with pytest.raises(ValueError, match="unsafe"):
        extract_zip(archive)

    assert not (tmp_path.parent / "evil.py").exists()


def test_rejects_symbolic_links(tmp_path):
    def build(archive):
        info = zipfile.ZipInfo("link.py")
        info.external_attr = 0o120777 << 16
        archive.writestr(info, "/etc/passwd")

    with pytest.raises(ValueError, match="symbolic link"):
        extract_zip(_archive(tmp_path, build=build))


def test_rejects_archives_over_the_extracted_size_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(file_handler, "MAX_EXTRACTED_SIZE", 100)

    with pytest.raises(ValueError, match="exceeds"):
        extract_zip(_archive(tmp_path, {"a.py": "x" * 80, "b.py": "y" * 80}))


def test_skips_files_over_the_single_file_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(file_handler, "MAX_SINGLE_FILE_SIZE", 10)

    root = Path(extract_zip(_archive(tmp_path, {"big.py": "x" * 50, "small.py": "y"})))

    assert not (root / "big.py").exists()
    assert (root / "small.py").exists()


def test_rejects_uploads_over_the_archive_size_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(file_handler, "MAX_ARCHIVE_SIZE", 10)

    with pytest.raises(ValueError, match="exceeds"):
        extract_zip(_archive(tmp_path, {"a.py": "x" * 100}))


def test_missing_archive_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        extract_zip(tmp_path / "missing.zip")


@pytest.mark.parametrize(
    ("name", "portable"),
    [
        ("main.py", True),
        (".gitignore", True),
        ("CON", False),
        ("lpt1.txt", False),
        ("a?b", False),
        ("tab\tname", False),
        ("dot.", False),
        ("space ", False),
        ("", False),
        ("..", False),
    ],
)
def test_is_portable_name(name, portable):
    assert is_portable_name(name) is portable


# --- clone_github_repo validation --------------------------------------------


@pytest.mark.parametrize(
    ("url", "message"),
    [
        # X1 accepts http://, query strings, fragments and sub-pages; the full
        # table of accepted and rejected links is in tests/test_repo_url.py.
        ("https://gitlab.com/a/b", "GitHub"),
        ("https://github.com.evil.com/a/b", "GitHub"),
        ("https://user:pw@github.com/a/b", "credentials"),
        ("ssh://git@github.com/a/b", "https://"),
        ("https://github.com/a", "owner/repository"),
        ("https://github.com/a;rm/b", "owner"),
        ("https://github.com/a/b$(id)", "repository name"),
    ],
)
def test_github_url_validation(url, message, monkeypatch):
    def never_called(*args, **kwargs):
        raise AssertionError("git must not run for an invalid URL")

    monkeypatch.setattr(file_handler.subprocess, "run", never_called)

    with pytest.raises(ValueError, match=message):
        clone_github_repo(url)


def test_clone_uses_a_safe_argument_list(monkeypatch):
    captured = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        Path(args[-1]).mkdir(parents=True)
        (Path(args[-1]) / "main.py").write_text("x = 1")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(file_handler.subprocess, "run", fake_run)

    clone_github_repo("https://github.com/owner/repo.git")

    args = captured["args"]
    assert args[0] == "git" and "clone" in args
    # Options end before the URL, so nothing user-controlled can be an option.
    assert args[args.index("--") + 1] == "https://github.com/owner/repo.git"
    assert args[-1].endswith("repository")
    assert "shell" not in captured["kwargs"]
    assert captured["kwargs"]["timeout"] > 0
    assert captured["kwargs"]["env"]["GIT_TERMINAL_PROMPT"] == "0"


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (subprocess.TimeoutExpired(["git"], 180), "timed out"),
        (FileNotFoundError(), "Git is not installed"),
        # git's own message (it contains local paths) is logged, not returned.
        (subprocess.CalledProcessError(128, ["git"], stderr="fatal: nope"), "could not clone"),
    ],
)
def test_clone_errors_become_runtime_errors(monkeypatch, error, message):
    def failing(*args, **kwargs):
        raise error

    monkeypatch.setattr(file_handler.subprocess, "run", failing)

    with pytest.raises(RuntimeError, match=message):
        clone_github_repo("https://github.com/owner/repo")


# --- get_code_files ----------------------------------------------------------


def test_code_file_discovery_filters_noise(tmp_path, monkeypatch):
    monkeypatch.setattr(file_handler, "MAX_SINGLE_FILE_SIZE", 1_000)
    files = {
        "src/app.py": "x = 1",
        "src/web.tsx": "export {}",
        "node_modules/lib/index.js": "x",
        ".git/config.json": "{}",
        "venv/lib.py": "x",
        ".env": "KEY=1",
        ".env.production": "KEY=1",
        "credentials.json": "{}",
        "image.png": "png",
        "big.py": "x" * 2_000,
    }
    for relative, content in files.items():
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    (tmp_path / "binary.py").write_bytes(b"\x00\x01\x02")

    found = sorted(
        Path(path).relative_to(tmp_path).as_posix() for path in get_code_files(tmp_path)
    )

    assert found == ["src/app.py", "src/web.tsx"]
