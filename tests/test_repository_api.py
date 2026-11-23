"""Repository, file-content and AI-explanation endpoints."""

import re
from pathlib import Path

import pytest

from backend.services import repository_service
from tests.helpers import make_zip, upload_repo

FILES = {
    "app/main.py": "import os\npassword = 'hunter2'\n",
    "app/util.py": "def helper():\n    return 1\n",
    "README.md": "# Sample\n",
    ".env": "GROQ_API_KEY=real-key\n",
}


@pytest.fixture
def repo(client):
    return upload_repo(client, FILES)


def _repo_path(repo_id):
    return Path(repository_service.get_repository(repo_id)["path"])


def test_upload_registers_repository(client, repo):
    assert repo["name"] == "sample"
    assert repo["source"] == "zip"
    assert repo["file_count"] == 3
    assert "path" not in repo
    assert client.get("/api/repositories").json()[0]["id"] == repo["id"]


@pytest.mark.parametrize("name", ["notes.txt", "archive.tar.gz", "zip"])
def test_upload_requires_a_zip_filename(client, name):
    response = client.post(
        "/api/repositories/upload",
        files={"file": (name, make_zip({"a.py": "x"}), "application/zip")},
    )
    assert response.status_code == 400


def test_upload_rejects_empty_files(client):
    response = client.post(
        "/api/repositories/upload",
        files={"file": ("a.zip", b"", "application/zip")},
    )
    assert response.status_code == 400


def test_file_listing_is_relative_and_hides_secrets(client, repo):
    body = client.get(f"/api/repositories/{repo['id']}/files").json()

    assert body["total_files"] == 3
    assert [f["path"] for f in body["files"]] == ["README.md", "app/main.py", "app/util.py"]


def test_file_content(client, repo):
    response = client.get(
        f"/api/repositories/{repo['id']}/files/content", params={"path": "app/util.py"}
    )

    assert response.status_code == 200
    assert response.json()["content"].startswith("def helper")


@pytest.mark.parametrize(
    ("path", "status"),
    [
        ("../.codelens_repositories.json", 403),
        ("app/../../x", 403),
        ("/etc/passwd", 403),
        ("C:/Windows/win.ini", 403),
        ("app\\..\\..\\x", 403),
        (".env", 403),
        ("missing.py", 404),
        ("app", 404),
    ],
)
def test_file_content_guards(client, repo, path, status):
    response = client.get(
        f"/api/repositories/{repo['id']}/files/content", params={"path": path}
    )

    assert response.status_code == status


def test_file_content_rejects_oversized_files(client, repo):
    (_repo_path(repo["id"]) / "big.py").write_text("x" * (1024 * 1024 + 1))

    response = client.get(
        f"/api/repositories/{repo['id']}/files/content", params={"path": "big.py"}
    )

    assert response.status_code == 404
    assert "maximum" in response.json()["detail"]


def test_file_content_rejects_undecodable_files(client, repo):
    (_repo_path(repo["id"]) / "latin.py").write_bytes(b"\xff\xfe\xfa bad")

    response = client.get(
        f"/api/repositories/{repo['id']}/files/content", params={"path": "latin.py"}
    )

    assert response.status_code == 404


def test_unknown_repository_is_404(client):
    rid = "0" * 32
    assert client.get(f"/api/repositories/{rid}/files").status_code == 404
    assert (
        client.get(f"/api/repositories/{rid}/files/content", params={"path": "a"}).status_code
        == 404
    )


def test_repository_whose_directory_vanished_is_not_listed(client, repo):
    import shutil

    shutil.rmtree(_repo_path(repo["id"]))

    assert client.get("/api/repositories").json() == []
    assert client.get(f"/api/repositories/{repo['id']}/files").status_code == 404


# --- AI explanation ------------------------------------------------------------


def _explain(client, repo_id, path):
    return client.post(
        f"/api/repositories/{repo_id}/files/explain", json={"file_path": path}
    )


def test_explain_sends_redacted_content(client, repo, fake_llm):
    fake_llm.response = "## What it does\nExplains."

    response = _explain(client, repo["id"], "app/main.py")

    assert response.status_code == 200
    assert response.json()["explanation"].startswith("## What it does")
    (prompt,) = fake_llm.calls
    assert "import os" in prompt
    assert "hunter2" not in prompt


@pytest.mark.parametrize(
    ("path", "message"),
    [
        ("../x.py", "Invalid file path"),
        ("/etc/passwd", "outside|Invalid"),
        (".env", "Sensitive"),
        ("missing.py", "not found"),
    ],
)
def test_explain_guards(client, repo, fake_llm, path, message):
    response = _explain(client, repo["id"], path)

    assert response.status_code == 400
    assert re.search(message, response.json()["detail"])
    assert fake_llm.calls == []


def test_explain_reports_provider_errors(client, repo, fake_llm):
    fake_llm.error = RuntimeError("Groq API Error: rate limited")

    response = _explain(client, repo["id"], "app/main.py")

    assert response.status_code == 502
    assert "rate limited" in response.json()["detail"]


def test_explain_marks_truncated_files(client, repo, fake_llm):
    (_repo_path(repo["id"]) / "long.py").write_text("x = 1\n" * 3_000)

    body = _explain(client, repo["id"], "long.py").json()

    assert body["truncated"] is True
    assert len(fake_llm.calls[0]) < 14_000


# --- AI summary ----------------------------------------------------------------


def test_summary_marks_truncation(client, repo, fake_llm):
    (_repo_path(repo["id"]) / "long.py").write_text("x = 1\n" * 6_000)

    body = client.post(f"/api/repositories/{repo['id']}/summary").json()

    assert body["truncated"] is True
    assert "Only a portion" in body["summary"]


def test_summary_never_sends_sensitive_files(client, repo, fake_llm):
    client.post(f"/api/repositories/{repo['id']}/summary")

    (prompt,) = fake_llm.calls
    assert "real-key" not in prompt
    assert "hunter2" not in prompt


def test_summary_provider_errors_are_502(client, repo, fake_llm):
    fake_llm.error = RuntimeError("Groq API Error: down")

    response = client.post(f"/api/repositories/{repo['id']}/summary")

    assert response.status_code == 502
    assert client.get(f"/api/repositories/{repo['id']}/summary").status_code == 404


def test_summary_prompt_contains_no_server_paths(client, repo, fake_llm, upload_root):
    client.post(f"/api/repositories/{repo['id']}/summary")

    (prompt,) = fake_llm.calls
    assert str(upload_root) not in prompt
