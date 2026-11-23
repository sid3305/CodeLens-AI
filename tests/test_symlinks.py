"""
SEC-07: symbolic links and Windows junctions are never followed.

A cloned repository can contain `notes.md -> ~/.aws/credentials`. Reading
it would expose a file outside the repository (and send it to the LLM).
Real symlinks need a privilege on Windows, so those tests skip there; the
resolve-and-contain check is unit-tested everywhere, and Windows directory
junctions (no privilege needed) are tested for real on Windows.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from backend.services import repository_service
from tests.helpers import allow_ai, upload_repo
from utils import file_handler
from utils.file_handler import get_code_files
from utils.security import is_link, resolve_within

SECRET = "AWS_SECRET=do-not-leak-me"


def _can_symlink(tmp_path):
    try:
        os.symlink(tmp_path, tmp_path / "probe", target_is_directory=True)
    except (OSError, NotImplementedError):
        return False
    os.unlink(tmp_path / "probe")
    return True


def _make_junction(link: Path, target: Path):
    import _winapi

    _winapi.CreateJunction(str(target), str(link))


needs_symlinks = pytest.mark.skipif(
    sys.platform == "win32",
    reason="creating symlinks on Windows needs SeCreateSymbolicLinkPrivilege; covered on Linux CI",
)
windows_only = pytest.mark.skipif(sys.platform != "win32", reason="directory junctions are Windows-only")


@pytest.fixture
def outside(tmp_path):
    folder = tmp_path / "outside"
    folder.mkdir()
    (folder / "credentials").write_text(SECRET)
    (folder / "secret.py").write_text(f"# {SECRET}\n")
    return folder


@pytest.fixture
def repo(client):
    repo = upload_repo(client)
    return repo, Path(repository_service.get_repository(repo["id"])["path"])


# --- resolve_within: unit tests, no links needed --------------------------------


@pytest.mark.parametrize("relative", ["../x.py", "a/../../x.py", "/etc/passwd", "C:/x.py", "C:x.py", "a\\..\\..\\x"])
def test_resolve_within_rejects_escaping_paths(tmp_path, relative):
    with pytest.raises(ValueError):
        resolve_within(tmp_path, relative)


def test_resolve_within_returns_contained_paths(tmp_path):
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "a.py").write_text("x")

    assert resolve_within(tmp_path, "pkg/a.py") == (tmp_path / "pkg" / "a.py").resolve()


def test_resolve_within_rejects_any_link_component(tmp_path, monkeypatch):
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "a.py").write_text("x")
    linked = tmp_path / "pkg"
    real_is_symlink = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda self: self == linked or real_is_symlink(self))

    with pytest.raises(ValueError, match="(?i)link"):
        resolve_within(tmp_path, "pkg/a.py")


def test_resolve_within_rejects_paths_resolving_outside(tmp_path, monkeypatch):
    (tmp_path / "a.py").write_text("x")
    elsewhere = tmp_path.parent
    real_resolve = Path.resolve
    monkeypatch.setattr(
        Path, "resolve",
        lambda self, *a, **k: elsewhere / "a.py" if self.name == "a.py" else real_resolve(self, *a, **k),
    )

    with pytest.raises(ValueError, match="outside"):
        resolve_within(tmp_path, "a.py")


# --- Windows junctions (real) -----------------------------------------------------


@windows_only
def test_junctions_are_detected(tmp_path, outside):
    _make_junction(tmp_path / "linked", outside)

    assert is_link(tmp_path / "linked")
    assert not is_link(outside)


@windows_only
def test_junction_contents_are_never_listed_or_served(client, repo, outside, fake_llm):
    record, root = repo
    allow_ai(client, record)
    _make_junction(root / "linked", outside)

    listed = [Path(p).relative_to(root).as_posix() for p in get_code_files(root)]
    content = client.get(
        f"/api/repositories/{record['id']}/files/content", params={"path": "linked/secret.py"}
    )
    explain = client.post(
        f"/api/repositories/{record['id']}/files/explain", json={"file_path": "linked/secret.py"}
    )
    client.post(f"/api/repositories/{record['id']}/summary")
    deps = client.get(f"/api/repositories/{record['id']}/dependencies").text

    assert not any(p.startswith("linked/") for p in listed)
    assert content.status_code == 403
    assert explain.status_code == 400
    assert all(SECRET not in prompt for prompt in fake_llm.calls)
    assert "linked/secret.py" not in deps


@windows_only
def test_clone_strips_junctions(client, upload_root, outside, monkeypatch):
    def fake_clone(args, **kwargs):
        destination = Path(args[-1])
        destination.mkdir(parents=True)
        (destination / "main.py").write_text("x = 1\n")
        _make_junction(destination / "linked", outside)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(file_handler.subprocess, "run", fake_clone)

    repo = client.post("/api/repositories/github", json={"repo_url": "https://github.com/o/r"}).json()
    root = Path(repository_service.get_repository(repo["id"])["path"])

    assert not (root / "linked").exists()
    assert (outside / "secret.py").exists()  # the target was not touched


# --- Real symlinks (POSIX) ----------------------------------------------------------


@needs_symlinks
def test_symlinked_file_is_never_listed_or_served(client, repo, outside, fake_llm):
    record, root = repo
    (root / "notes.md").symlink_to(outside / "credentials")
    (root / "linked").symlink_to(outside, target_is_directory=True)

    listed = [Path(p).relative_to(root).as_posix() for p in get_code_files(root)]
    content = client.get(
        f"/api/repositories/{record['id']}/files/content", params={"path": "notes.md"}
    )
    explain = client.post(
        f"/api/repositories/{record['id']}/files/explain", json={"file_path": "notes.md"}
    )
    client.post(f"/api/repositories/{record['id']}/summary")

    assert "notes.md" not in listed
    assert not any(p.startswith("linked/") for p in listed)
    assert content.status_code == 403
    assert explain.status_code == 400
    assert all(SECRET not in prompt for prompt in fake_llm.calls)


@needs_symlinks
def test_clone_strips_symlinks(client, outside, monkeypatch):
    def fake_clone(args, **kwargs):
        destination = Path(args[-1])
        destination.mkdir(parents=True)
        (destination / "main.py").write_text("x = 1\n")
        (destination / "notes.md").symlink_to(outside / "credentials")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(file_handler.subprocess, "run", fake_clone)

    repo = client.post("/api/repositories/github", json={"repo_url": "https://github.com/o/r"}).json()
    root = Path(repository_service.get_repository(repo["id"])["path"])

    assert not (root / "notes.md").exists() and not (root / "notes.md").is_symlink()
    assert (outside / "credentials").read_text() == SECRET
