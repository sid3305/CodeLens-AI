"""A5: ZIP / GitHub import hardening (BUG-13/14/15/16, SEC-03)."""

import subprocess
import time
from pathlib import Path

import pytest

from utils import file_handler
from tests.helpers import SAMPLE_REPO, make_zip


def _upload(client, archive, name="repo.zip"):
    return client.post(
        "/api/repositories/upload",
        files={"file": (name, archive, "application/zip")},
    )


def _workspaces(upload_root: Path):
    if not upload_root.exists():
        return []
    return [p for p in upload_root.iterdir() if p.is_dir()]


# --- ZIP uploads -----------------------------------------------------------


def test_entry_count_bomb_is_rejected_quickly(client, upload_root, monkeypatch):
    """SEC-03: a tiny ZIP with a huge number of entries must not be extracted."""

    monkeypatch.setattr(file_handler, "MAX_ARCHIVE_ENTRIES", 500)
    archive = make_zip({f"e/{i}.txt": "" for i in range(501)})

    started = time.perf_counter()
    response = _upload(client, archive)
    elapsed = time.perf_counter() - started

    assert response.status_code == 400
    assert "entries" in response.json()["detail"].lower()
    assert elapsed < 5
    assert _workspaces(upload_root) == []


def test_non_zip_file_is_a_client_error(client, upload_root):
    """BUG-14: a non-ZIP file named .zip returned 500."""

    response = _upload(client, b"this is not a zip")

    assert response.status_code == 400
    assert "zip" in response.json()["detail"].lower()
    assert _workspaces(upload_root) == []


@pytest.mark.parametrize(
    "bad_name",
    ["<script>.py", "aux.py", "con", "a:b.py", "trailing.py.", "pipe|name.py"],
)
def test_names_invalid_on_windows_are_skipped(client, bad_name):
    """BUG-15: one non-portable file name used to fail the whole import."""

    files = dict(SAMPLE_REPO)
    files[f"pkg/{bad_name}"] = "x = 1\n"

    response = _upload(client, make_zip(files, prefix="sample/"))

    assert response.status_code == 200, response.text
    repo = response.json()
    paths = [
        f["path"]
        for f in client.get(f"/api/repositories/{repo['id']}/files").json()["files"]
    ]
    assert "app/main.py" in paths
    assert not any(bad_name in p for p in paths)


def test_backslash_separators_are_normalised(client):
    archive = make_zip({"sample\\app\\main.py": "x = 1\n"})

    response = _upload(client, archive)

    assert response.status_code == 200, response.text
    repo_id = response.json()["id"]
    paths = [
        f["path"]
        for f in client.get(f"/api/repositories/{repo_id}/files").json()["files"]
    ]
    assert paths == ["app/main.py"]


def test_backslash_traversal_is_rejected(client, upload_root):
    response = _upload(client, make_zip({"..\\..\\evil.py": "x"}))

    assert response.status_code == 400
    assert _workspaces(upload_root) == []


@pytest.mark.parametrize(
    "files",
    [
        {},
        {"image.png": "\x89PNG", "data.bin": "\x00\x01"},
        {"LICENSE": "MIT"},
    ],
    ids=["empty", "binary-only", "no-supported-extensions"],
)
def test_repository_without_source_files_is_rejected(client, upload_root, files):
    """BUG-16: empty and non-code archives were registered with 0 files."""

    response = _upload(client, make_zip(files))

    assert response.status_code == 400
    assert "no supported source files" in response.json()["detail"].lower()
    assert client.get("/api/repositories").json() == []
    assert _workspaces(upload_root) == []


# --- GitHub imports --------------------------------------------------------


def _fake_clone(files):
    """Return a subprocess.run replacement that 'clones' the given files."""

    def run(args, **kwargs):
        destination = Path(args[-1])
        for relative, content in files.items():
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        return subprocess.CompletedProcess(args, 0, "", "")

    return run


def _import(client, url="https://github.com/owner/repo"):
    return client.post("/api/repositories/github", json={"repo_url": url})


def test_failed_clone_leaves_no_orphan_workspace(client, upload_root, monkeypatch):
    """BUG-13: a failed clone left an empty, undeletable workspace behind."""

    def failing_run(args, **kwargs):
        raise subprocess.CalledProcessError(128, args, stderr="not found")

    monkeypatch.setattr(file_handler.subprocess, "run", failing_run)

    response = _import(client)

    assert response.status_code == 502
    assert _workspaces(upload_root) == []


def test_oversized_clone_is_rejected_and_removed(client, upload_root, monkeypatch):
    """SEC-03: clones had no size limit."""

    monkeypatch.setattr(file_handler, "MAX_EXTRACTED_SIZE", 1_000)
    monkeypatch.setattr(
        file_handler.subprocess,
        "run",
        _fake_clone({"big.py": "x" * 5_000}),
    )

    response = _import(client)

    assert response.status_code == 400
    assert "size" in response.json()["detail"].lower()
    assert _workspaces(upload_root) == []


def test_clone_without_source_files_is_rejected(client, upload_root, monkeypatch):
    monkeypatch.setattr(
        file_handler.subprocess, "run", _fake_clone({"README": "hello"})
    )

    response = _import(client)

    assert response.status_code == 400
    assert _workspaces(upload_root) == []


def test_successful_clone_is_registered(client, monkeypatch):
    monkeypatch.setattr(
        file_handler.subprocess, "run", _fake_clone({"main.py": "x = 1\n"})
    )

    response = _import(client, "https://github.com/owner/my-repo.git")

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "my-repo"
    assert response.json()["file_count"] == 1
