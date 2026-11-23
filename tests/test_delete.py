"""A6: repository deletion and orphan cleanup (BUG-09, BUG-13)."""

import os
import stat
from pathlib import Path

from backend.services import repository_service
from tests.helpers import upload_repo


def _make_read_only_git_objects(repo_path: Path):
    """Mimic Git on Windows, which marks object files read-only."""

    objects = repo_path / ".git" / "objects" / "ab"
    objects.mkdir(parents=True)
    packed = objects / "cdef0123"
    packed.write_bytes(b"blob")
    os.chmod(packed, stat.S_IREAD)
    return packed


def test_delete_removes_read_only_files(client, upload_root):
    """BUG-09: deleting a cloned repo failed with 500 on Windows."""

    repo = upload_repo(client)
    repo_path = Path(repository_service.get_repository(repo["id"])["path"])
    _make_read_only_git_objects(repo_path)

    response = client.delete(f"/api/repositories/{repo['id']}")

    assert response.status_code == 200, response.text
    assert not (upload_root / repo["id"]).exists()
    assert client.get("/api/repositories").json() == []


def test_delete_unknown_repository_is_404(client):
    assert client.delete("/api/repositories/" + "0" * 32).status_code == 404


def test_delete_rejects_traversal_ids(client, upload_root):
    upload_root.mkdir(parents=True, exist_ok=True)
    assert client.delete("/api/repositories/..").status_code in (404, 405)


def test_sweep_removes_only_unregistered_workspaces(client, upload_root):
    repo = upload_repo(client)
    orphan = upload_root / ("f" * 32)
    orphan.mkdir()
    _make_read_only_git_objects(orphan)
    unrelated = upload_root / "keep-me"
    unrelated.mkdir()

    removed = repository_service.sweep_orphan_workspaces()

    assert removed == ["f" * 32]
    assert not orphan.exists()
    assert unrelated.exists()
    assert (upload_root / repo["id"]).exists()


def test_orphans_are_swept_on_startup(upload_root):
    from fastapi.testclient import TestClient

    from backend.main import app

    orphan = upload_root / ("e" * 32)
    orphan.mkdir(parents=True)

    with TestClient(app):
        pass

    assert not orphan.exists()
