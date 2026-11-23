"""A3 / BUG-19: an analysis where some analyzers fail must not claim success."""

import pytest

import utils.analysis_engine as engine
from tests.helpers import upload_repo


def _ok(_path):
    return []


def _missing(_path):
    raise RuntimeError("Tool is not installed or unavailable on PATH.")


@pytest.fixture
def analyzers(monkeypatch):
    def configure(**behaviour):
        for name, func in behaviour.items():
            monkeypatch.setattr(engine, f"run_{name}_analysis", func)

    return configure


def test_all_analyzers_succeed_reports_completed(client, analyzers):
    analyzers(ruff=_ok, bandit=_ok, semgrep=_ok, gitleaks=_ok)
    repo = upload_repo(client)

    body = client.post(f"/api/repositories/{repo['id']}/analyze").json()

    assert body["status"] == "completed"


def test_some_analyzers_failing_reports_partial(client, analyzers):
    analyzers(ruff=_ok, bandit=_ok, semgrep=_missing, gitleaks=_missing)
    repo = upload_repo(client)

    body = client.post(f"/api/repositories/{repo['id']}/analyze").json()

    assert body["status"] == "partial"
    assert body["tool_status"]["Semgrep"]["status"] == "Failed"
    assert body["tool_status"]["Ruff"]["status"] == "Completed"


def test_every_analyzer_failing_reports_failed(client, analyzers):
    analyzers(ruff=_missing, bandit=_missing, semgrep=_missing, gitleaks=_missing)
    repo = upload_repo(client)

    body = client.post(f"/api/repositories/{repo['id']}/analyze").json()

    assert body["status"] == "failed"
