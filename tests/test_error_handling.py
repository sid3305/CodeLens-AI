"""D5 / SEC-09: unexpected errors are logged, never echoed to the client."""

import logging

import pytest

from backend.routers import dependencies as dependencies_router
from tests.helpers import upload_repo

SECRET = "C:/Users/someone/private/path"


@pytest.mark.parametrize(
    "suffix", ["", "/circular", "/external", "/module-graph", "/stats"]
)
def test_dependency_errors_do_not_leak_details(client, monkeypatch, caplog, suffix):
    repo = upload_repo(client)

    def explode(*_args, **_kwargs):
        raise KeyError(SECRET)

    monkeypatch.setattr(dependencies_router, "parse_repository", explode)

    with caplog.at_level(logging.ERROR):
        response = client.get(f"/api/repositories/{repo['id']}/dependencies{suffix}")

    assert response.status_code == 500
    assert SECRET not in response.text
    assert SECRET in caplog.text


def test_unexpected_ai_errors_are_logged(client, monkeypatch, caplog):
    from backend.routers import ai as ai_router

    repo = upload_repo(client)

    def explode(*_args, **_kwargs):
        raise KeyError(SECRET)

    monkeypatch.setattr(ai_router, "run_repo_agent", explode)

    with caplog.at_level(logging.ERROR):
        response = client.post(f"/api/repositories/{repo['id']}/summary")

    assert response.status_code == 500
    assert SECRET not in response.text
    assert SECRET in caplog.text
