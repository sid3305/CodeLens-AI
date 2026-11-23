from tests.helpers import upload_repo


def test_summary_is_cached_without_force(client, fake_llm):
    repo = upload_repo(client)
    url = f"/api/repositories/{repo['id']}/summary"

    fake_llm.response = "first"
    assert client.post(url).json()["summary"] == "first"

    fake_llm.response = "second"
    assert client.post(url).json()["summary"] == "first"
    assert len(fake_llm.calls) == 1


def test_force_regenerates_summary(client, fake_llm):
    """A2 / BUG-05: Regenerate must call the LLM again and persist the result."""

    repo = upload_repo(client)
    url = f"/api/repositories/{repo['id']}/summary"

    fake_llm.response = "first"
    client.post(url)

    fake_llm.response = "second"
    response = client.post(url, params={"force": "true"})

    assert response.status_code == 200
    assert response.json()["summary"] == "second"
    assert len(fake_llm.calls) == 2
    assert client.get(url).json()["summary"] == "second"


def test_get_summary_never_calls_llm(client, fake_llm):
    repo = upload_repo(client)

    response = client.get(f"/api/repositories/{repo['id']}/summary")

    assert response.status_code == 404
    assert fake_llm.calls == []
