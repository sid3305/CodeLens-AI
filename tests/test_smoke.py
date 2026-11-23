from pathlib import Path


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_repository_list_starts_empty(client):
    response = client.get("/api/repositories")
    assert response.status_code == 200
    assert response.json() == []


def test_live_llm_is_blocked():
    import pytest

    from utils.llm import call_llm

    with pytest.raises((RuntimeError, ValueError)):
        call_llm("hello")


def test_analyzer_targets_are_not_collected_as_tests():
    targets = Path(__file__).parent / "fixtures" / "analyzer_targets"
    assert not any(p.name.startswith("test_") for p in targets.iterdir())
