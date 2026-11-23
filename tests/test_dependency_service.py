"""B2: dependency analysis is computed once, persisted, and served safely."""

import json
import threading
import time

import pytest

from backend.services import dependency_service
from tests.helpers import upload_repo

ROUTES = ["", "/circular", "/external", "/module-graph", "/stats"]

# 60 Python files in a chain plus an internal cycle, so graphs exceed 50 nodes.
MANY_FILES = {
    **{
        f"pkg/m{i}.py": f"from pkg import m{i + 1}\n\ndef f{i}():\n    return f{i}()\n"
        for i in range(59)
    },
    "pkg/m59.py": "from pkg import m0\n",
    "pkg/__init__.py": "",
}


@pytest.fixture
def compute_calls(monkeypatch):
    """Count how often the expensive analysis actually runs."""

    calls = []
    original = dependency_service.compute_dependency_report

    def counting(*args, **kwargs):
        calls.append(args)
        return original(*args, **kwargs)

    monkeypatch.setattr(dependency_service, "compute_dependency_report", counting)
    return calls


def _url(repo, suffix=""):
    return f"/api/repositories/{repo['id']}/dependencies{suffix}"


def test_report_is_computed_once_and_persisted(client, upload_root, compute_calls):
    repo = upload_repo(client)

    first = client.get(_url(repo)).json()
    second = client.get(_url(repo)).json()

    assert len(compute_calls) == 1
    assert first == second
    cached = json.loads((upload_root / repo["id"] / "dependencies.json").read_text())
    assert cached["version"] == dependency_service.CACHE_VERSION


def test_every_route_shares_the_cache(client, compute_calls):
    repo = upload_repo(client)

    for suffix in ROUTES:
        assert client.get(_url(repo, suffix)).status_code == 200

    assert len(compute_calls) == 1


def test_refresh_recomputes(client, compute_calls):
    repo = upload_repo(client)
    client.get(_url(repo))

    response = client.get(_url(repo), params={"refresh": "true"})

    assert response.status_code == 200
    assert len(compute_calls) == 2


@pytest.mark.parametrize(
    "content",
    ["{not json", json.dumps({"version": -1, "report": {}}), json.dumps(["wrong"])],
    ids=["corrupt", "old-version", "wrong-shape"],
)
def test_unusable_cache_is_recomputed(client, upload_root, compute_calls, content):
    repo = upload_repo(client)
    (upload_root / repo["id"] / "dependencies.json").write_text(content)

    response = client.get(_url(repo))

    assert response.status_code == 200
    assert len(compute_calls) == 1


def test_reimport_starts_from_a_fresh_cache(client, compute_calls):
    first = upload_repo(client)
    client.get(_url(first))

    second = upload_repo(client)
    client.get(_url(second))

    assert second["id"] != first["id"]
    assert len(compute_calls) == 2


def test_concurrent_first_requests_compute_once(client, monkeypatch):
    repo = upload_repo(client)
    original = dependency_service.compute_dependency_report
    calls = []

    def slow(*args, **kwargs):
        calls.append(args)
        time.sleep(0.3)
        return original(*args, **kwargs)

    monkeypatch.setattr(dependency_service, "compute_dependency_report", slow)

    threads = [threading.Thread(target=client.get, args=(_url(repo),)) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(calls) == 1


def test_computation_does_not_block_the_event_loop(client, monkeypatch):
    repo = upload_repo(client)
    started = threading.Event()
    original = dependency_service.compute_dependency_report

    def slow(*args, **kwargs):
        started.set()
        time.sleep(1.0)
        return original(*args, **kwargs)

    monkeypatch.setattr(dependency_service, "compute_dependency_report", slow)
    worker = threading.Thread(target=client.get, args=(_url(repo),))
    worker.start()
    assert started.wait(5)

    began = time.perf_counter()
    assert client.get("/api/health").status_code == 200
    elapsed = time.perf_counter() - began
    worker.join()

    assert elapsed < 0.5


# --- max_nodes -----------------------------------------------------------------


@pytest.mark.parametrize("max_nodes", [50, 60])
def test_max_nodes_limits_both_graphs(client, max_nodes):
    repo = upload_repo(client, MANY_FILES)

    data = client.get(_url(repo), params={"max_nodes": max_nodes}).json()
    graph = data["dependency_graph_data"]

    assert len(graph["nodes"]) <= max_nodes
    assert graph["showingNodes"] == len(graph["nodes"])
    assert graph["totalNodes"] > max_nodes
    assert len(graph["moduleGraph"]["nodes"]) <= max_nodes
    shown = {node["id"] for node in graph["moduleGraph"]["nodes"]}
    assert all(e["source"] in shown and e["target"] in shown for e in graph["moduleGraph"]["edges"])
    node_ids = {node["id"] for node in graph["nodes"]}
    assert all(e["source"] in node_ids and e["target"] in node_ids for e in graph["edges"])


def test_max_nodes_does_not_change_the_analysis(client):
    repo = upload_repo(client, MANY_FILES)

    small = client.get(_url(repo), params={"max_nodes": 50}).json()
    large = client.get(_url(repo), params={"max_nodes": 500}).json()

    assert small["module_dependencies"] == large["module_dependencies"]
    assert small["stats"] == large["stats"]
    assert len(small["dependency_graph_data"]["moduleGraph"]["nodes"]) == 50
    assert len(large["dependency_graph_data"]["moduleGraph"]["nodes"]) == 61


# --- paths ---------------------------------------------------------------------


def test_no_absolute_paths_in_any_route_or_the_cache(client, upload_root):
    repo = upload_repo(client, MANY_FILES)
    root_text = str(upload_root)

    for suffix in ROUTES:
        body = client.get(_url(repo, suffix)).text
        assert root_text not in body
        assert root_text.replace("\\", "\\\\") not in body

    cache = (upload_root / repo["id"] / "dependencies.json").read_text()
    assert root_text.replace("\\", "\\\\") not in cache
    assert root_text not in cache
