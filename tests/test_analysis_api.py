"""Analysis endpoints: run, persist, retrieve, concurrency."""

import pytest

from backend.services import analysis_service
from tests.helpers import upload_repo
from utils import analysis_engine

FILES = {
    "app/main.py": (
        "import subprocess\n"
        "API_KEY = 'sk_live_abcdef123456'\n"
        "def run(cmd):\n"
        "    return subprocess.call(cmd, shell=True)\n"
    ),
}


@pytest.fixture
def stub_analyzers(monkeypatch, upload_root):
    """Analyzers that report absolute paths, like the real tools do."""

    def bandit(path):
        return [
            {
                "tool": "Bandit",
                "category": "Security",
                "severity": "High",
                "file": f"{path}/app/main.py",
                "line": 4,
                "rule_id": "B602",
                "title": "shell",
                "description": "API_KEY = 'sk_live_abcdef123456' near here",
            }
        ]

    monkeypatch.setattr(analysis_engine, "run_ruff_analysis", lambda _p: [])
    monkeypatch.setattr(analysis_engine, "run_bandit_analysis", bandit)
    monkeypatch.setattr(analysis_engine, "run_semgrep_analysis", lambda _p: [])
    monkeypatch.setattr(analysis_engine, "run_gitleaks_analysis", lambda _p: [])


def test_analysis_is_persisted_with_relative_paths(client, stub_analyzers, upload_root):
    repo = upload_repo(client, FILES)

    run = client.post(f"/api/repositories/{repo['id']}/analyze").json()
    saved = client.get(f"/api/repositories/{repo['id']}/results").json()

    assert run == saved
    assert run["summary"]["total_findings"] == 1
    assert run["summary"]["severity_counts"] == {"High": 1}
    (finding,) = run["findings"]
    assert finding["file"] == "app/main.py"
    assert str(upload_root) not in str(run)


def test_secrets_in_findings_are_redacted(client, stub_analyzers):
    repo = upload_repo(client, FILES)

    body = client.post(f"/api/repositories/{repo['id']}/analyze").json()

    assert "sk_live_abcdef123456" not in str(body)


def test_concurrent_analysis_is_rejected(client, stub_analyzers):
    repo = upload_repo(client, FILES)

    # B3: the lock is per repository.
    lock = analysis_service.lock_for(repo["id"])
    assert lock.acquire(blocking=False)
    try:
        response = client.post(f"/api/repositories/{repo['id']}/analyze")
    finally:
        lock.release()

    assert response.status_code == 409


def test_unknown_repository(client):
    rid = "0" * 32
    assert client.post(f"/api/repositories/{rid}/analyze").status_code == 404
    assert client.get(f"/api/repositories/{rid}/results").status_code == 404


def test_corrupt_results_file_is_reported(client, stub_analyzers, upload_root):
    repo = upload_repo(client, FILES)
    client.post(f"/api/repositories/{repo['id']}/analyze")
    (upload_root / repo["id"] / "analysis_results.json").write_text("{not json")

    response = client.get(f"/api/repositories/{repo['id']}/results")

    assert response.status_code == 500


def test_unexpected_engine_errors_are_500(client, monkeypatch):
    repo = upload_repo(client, FILES)

    def explode(_path):
        raise KeyError("boom")

    monkeypatch.setattr(analysis_service, "run_all_analyzers", explode)

    response = client.post(f"/api/repositories/{repo['id']}/analyze")

    assert response.status_code == 500
    assert "boom" not in response.text


def test_no_results_yet_is_an_empty_200(client):
    repo = upload_repo(client, FILES)

    response = client.get(f"/api/repositories/{repo['id']}/results")

    assert response.status_code == 200
    assert response.json() is None
