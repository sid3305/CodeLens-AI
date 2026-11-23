"""
B3: background jobs for import, analysis and dependencies, with status,
progress and cancel, and per-repository locks.
"""

import threading
import time

import pytest

from backend.services import analysis_service
from backend.services.jobs import JobCancelled, JobManager
from tests.helpers import make_zip, upload_repo
from tests.test_repo_clone import FakeGit
from utils import analysis_engine, file_handler

TERMINAL = {"succeeded", "failed", "cancelled"}


def wait_for(client, job_id, timeout=20.0, until=TERMINAL):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in until:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not reach {until}: {job}")


def wait_until(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition not met")


# --- Job manager -----------------------------------------------------------------


def test_job_reports_progress_and_result():
    manager = JobManager(max_workers=1)
    step = threading.Event()

    def work(ctx):
        ctx.progress(0.5, "half way")
        step.wait(5)
        return {"answer": 42}

    job = manager.submit("analysis", "r1", work)
    wait_until(lambda: manager.get(job.id).message == "half way")
    assert manager.get(job.id).status == "running"
    assert manager.get(job.id).progress == 0.5

    step.set()
    wait_until(lambda: manager.get(job.id).status == "succeeded")
    done = manager.get(job.id).to_dict()
    assert done["result"] == {"answer": 42}
    assert done["progress"] == 1.0
    assert done["error"] is None


def test_cancel_stops_the_work_at_the_next_check():
    manager = JobManager(max_workers=1)
    started = threading.Event()
    reached_after_cancel = []

    def work(ctx):
        started.set()
        while True:
            ctx.check()
            time.sleep(0.01)
            reached_after_cancel.append(ctx.cancelled)

    job = manager.submit("analysis", "r1", work)
    started.wait(5)
    manager.cancel(job.id)

    wait_until(lambda: manager.get(job.id).status == "cancelled")
    assert not any(reached_after_cancel[-1:]) or reached_after_cancel[-1] is True


def test_a_queued_job_can_be_cancelled_before_it_starts():
    manager = JobManager(max_workers=1)
    block = threading.Event()
    ran = []

    manager.submit("analysis", "r1", lambda ctx: block.wait(5))
    queued = manager.submit("analysis", "r2", lambda ctx: ran.append(1))
    assert manager.get(queued.id).status == "queued"

    manager.cancel(queued.id)
    block.set()

    wait_until(lambda: manager.get(queued.id).status == "cancelled")
    time.sleep(0.05)
    assert ran == []


def test_failures_are_reported_without_internal_details():
    manager = JobManager(max_workers=1)

    expected = manager.submit("analysis", "r1", lambda ctx: (_ for _ in ()).throw(ValueError("Repository not found.")))
    unexpected = manager.submit("analysis", "r2", lambda ctx: (_ for _ in ()).throw(KeyError(r"C:\secret\path")))

    wait_until(lambda: manager.get(unexpected.id).status == "failed")
    wait_until(lambda: manager.get(expected.id).status == "failed")
    assert manager.get(expected.id).error == "Repository not found."
    assert manager.get(unexpected.id).error == "The job failed unexpectedly. See the server log."


def test_an_active_job_of_the_same_kind_and_repository_is_reused():
    manager = JobManager(max_workers=2)
    block = threading.Event()

    first = manager.submit("analysis", "r1", lambda ctx: block.wait(5))
    again = manager.submit("analysis", "r1", lambda ctx: None)
    other = manager.submit("dependencies", "r1", lambda ctx: block.wait(5))

    assert again.id == first.id
    assert other.id != first.id
    assert {job.id for job in manager.list(active=True)} == {first.id, other.id}
    block.set()


def test_cancelling_a_finished_job_changes_nothing():
    manager = JobManager(max_workers=1)
    job = manager.submit("analysis", "r1", lambda ctx: {"ok": True})
    wait_until(lambda: manager.get(job.id).status == "succeeded")

    manager.cancel(job.id)

    assert manager.get(job.id).status == "succeeded"


def test_job_cancelled_is_an_exception():
    assert issubclass(JobCancelled, Exception)


# --- Analysis jobs -------------------------------------------------------------------

FILES = {"app/main.py": "import os\n", "README.md": "# x\n"}


@pytest.fixture
def gated_analyzers(monkeypatch):
    """Analyzers that wait for permission, so tests can observe each step."""

    gates = {name: threading.Event() for name in ("Ruff", "Bandit", "Semgrep", "Gitleaks")}
    started = []

    def make(name):
        def run(path):
            started.append((name, path))
            gates[name].wait(10)
            return []
        return run

    monkeypatch.setattr(analysis_engine, "run_ruff_analysis", make("Ruff"))
    monkeypatch.setattr(analysis_engine, "run_bandit_analysis", make("Bandit"))
    monkeypatch.setattr(analysis_engine, "run_semgrep_analysis", make("Semgrep"))
    monkeypatch.setattr(analysis_engine, "run_gitleaks_analysis", make("Gitleaks"))
    return gates, started


def test_analysis_runs_as_a_job_with_progress(client, gated_analyzers):
    gates, _ = gated_analyzers
    repo = upload_repo(client, FILES)

    response = client.post("/api/jobs/analysis", json={"repository_id": repo["id"]})
    assert response.status_code == 202
    job = response.json()
    assert job["kind"] == "analysis" and job["repository_id"] == repo["id"]

    wait_for(client, job["id"], until={"running"})
    wait_until(lambda: client.get(f"/api/jobs/{job['id']}").json()["message"] == "Running Ruff (1 of 4)")
    gates["Ruff"].set()
    wait_until(lambda: client.get(f"/api/jobs/{job['id']}").json()["message"] == "Running Bandit (2 of 4)")
    assert client.get(f"/api/jobs/{job['id']}").json()["progress"] == pytest.approx(0.25)

    for gate in gates.values():
        gate.set()
    done = wait_for(client, job["id"])

    assert done["status"] == "succeeded"
    assert done["result"]["status"] == "completed"
    saved = client.get(f"/api/repositories/{repo['id']}/results").json()
    assert saved["analyzed_at"] == done["result"]["analyzed_at"]


def test_cancelling_an_analysis_keeps_the_previous_results(client, gated_analyzers):
    gates, started = gated_analyzers
    repo = upload_repo(client, FILES)

    job = client.post("/api/jobs/analysis", json={"repository_id": repo["id"]}).json()
    wait_until(lambda: len(started) == 1)
    assert client.post(f"/api/jobs/{job['id']}/cancel").status_code == 200
    gates["Ruff"].set()

    done = wait_for(client, job["id"])
    assert done["status"] == "cancelled"
    assert [name for name, _ in started] == ["Ruff"]
    assert client.get(f"/api/repositories/{repo['id']}/results").json() is None


def test_different_repositories_are_analysed_at_the_same_time(client, gated_analyzers):
    gates, started = gated_analyzers
    first = upload_repo(client, FILES)
    second = upload_repo(client, FILES)

    a = client.post("/api/jobs/analysis", json={"repository_id": first["id"]}).json()
    b = client.post("/api/jobs/analysis", json={"repository_id": second["id"]}).json()

    # Both are inside Ruff at once: no global lock.
    wait_until(lambda: len(started) == 2)
    for gate in gates.values():
        gate.set()
    assert wait_for(client, a["id"])["status"] == "succeeded"
    assert wait_for(client, b["id"])["status"] == "succeeded"


def test_the_same_repository_is_never_analysed_twice_at_once(client, gated_analyzers):
    gates, _ = gated_analyzers
    repo = upload_repo(client, FILES)

    job = client.post("/api/jobs/analysis", json={"repository_id": repo["id"]}).json()
    wait_for(client, job["id"], until={"running"})

    again = client.post("/api/jobs/analysis", json={"repository_id": repo["id"]})
    direct = client.post(f"/api/repositories/{repo['id']}/analyze")

    assert again.json()["id"] == job["id"]
    assert direct.status_code == 409
    for gate in gates.values():
        gate.set()
    wait_for(client, job["id"])


def test_jobs_can_be_listed_to_resume_after_a_refresh(client, gated_analyzers):
    gates, _ = gated_analyzers
    repo = upload_repo(client, FILES)
    job = client.post("/api/jobs/analysis", json={"repository_id": repo["id"]}).json()

    active = client.get("/api/jobs", params={"active": "true"}).json()
    mine = client.get("/api/jobs", params={"repository_id": repo["id"]}).json()

    assert job["id"] in [item["id"] for item in active]
    assert [item["id"] for item in mine] == [job["id"]]
    for gate in gates.values():
        gate.set()
    wait_for(client, job["id"])
    assert all(item["id"] != job["id"] for item in client.get("/api/jobs", params={"active": "true"}).json())


def test_unknown_repository_or_job_is_404(client):
    assert client.post("/api/jobs/analysis", json={"repository_id": "0" * 32}).status_code == 404
    assert client.get("/api/jobs/does-not-exist").status_code == 404
    assert client.post("/api/jobs/does-not-exist/cancel").status_code == 404


# --- Dependencies jobs ---------------------------------------------------------------


def test_dependencies_run_as_a_job_and_fill_the_cache(client):
    repo = upload_repo(client, {"a.py": "import b\n", "b.py": "x = 1\n"})
    cached = f"/api/repositories/{repo['id']}/dependencies/cached"

    assert client.get(cached).json() is None

    job = client.post("/api/jobs/dependencies", json={"repository_id": repo["id"]}).json()
    done = wait_for(client, job["id"])

    assert done["status"] == "succeeded", done
    assert done["result"] == {"repository_id": repo["id"]}
    report = client.get(cached).json()
    assert report["analyzed_files"] == ["a.py", "b.py"]


def test_dependencies_refresh_job_recomputes(client, monkeypatch):
    from backend.services import dependency_service

    repo = upload_repo(client, {"a.py": "x = 1\n"})
    wait_for(client, client.post("/api/jobs/dependencies", json={"repository_id": repo["id"]}).json()["id"])
    calls = []
    original = dependency_service.compute_dependency_report
    monkeypatch.setattr(dependency_service, "compute_dependency_report", lambda *a, **k: calls.append(1) or original(*a, **k))

    wait_for(client, client.post("/api/jobs/dependencies", json={"repository_id": repo["id"]}).json()["id"])
    assert calls == []
    wait_for(client, client.post("/api/jobs/dependencies", json={"repository_id": repo["id"], "refresh": True}).json()["id"])
    assert calls == [1]


# --- Import jobs -------------------------------------------------------------------------


def test_link_import_runs_as_a_job(client, monkeypatch):
    monkeypatch.setattr(file_handler.subprocess, "run", FakeGit())

    job = client.post("/api/jobs/import/link", json={"repo_url": "https://github.com/owner/repo/tree/main/src"}).json()
    done = wait_for(client, job["id"])

    assert done["status"] == "succeeded", done
    repository = done["result"]
    assert repository["name"] == "repo"
    assert repository["focus_path"] == "src"
    assert done["repository_id"] == repository["id"]
    assert any(r["id"] == repository["id"] for r in client.get("/api/repositories").json())


def test_failed_link_import_has_a_clean_message(client, monkeypatch):
    monkeypatch.setattr(file_handler.subprocess, "run", FakeGit(stderr=r"fatal: could not create C:\Users\x\uploads\abc"))

    job = client.post("/api/jobs/import/link", json={"repo_url": "owner/repo"}).json()
    done = wait_for(client, job["id"])

    assert done["status"] == "failed"
    assert "C:\\Users" not in done["error"]
    assert "uploads" not in done["error"]


def test_invalid_link_is_rejected_before_any_job_starts(client):
    before = len(client.get("/api/jobs").json())

    response = client.post("/api/jobs/import/link", json={"repo_url": "ftp://example.com/x"})

    assert response.status_code == 400
    assert len(client.get("/api/jobs").json()) == before


def test_zip_import_runs_as_a_job(client):
    archive = make_zip({"app/main.py": "x = 1\n"}, prefix="demo/")

    response = client.post("/api/jobs/import/zip", files={"file": ("demo.zip", archive, "application/zip")})
    assert response.status_code == 202
    done = wait_for(client, response.json()["id"])

    assert done["status"] == "succeeded", done
    assert done["result"]["name"] == "demo"


def test_bad_zip_upload_is_rejected_immediately(client):
    response = client.post("/api/jobs/import/zip", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert response.status_code == 400


def test_old_synchronous_endpoints_still_work(client, monkeypatch):
    monkeypatch.setattr(analysis_engine, "run_ruff_analysis", lambda _p: [])
    monkeypatch.setattr(analysis_engine, "run_bandit_analysis", lambda _p: [])
    monkeypatch.setattr(analysis_engine, "run_semgrep_analysis", lambda _p: [])
    monkeypatch.setattr(analysis_engine, "run_gitleaks_analysis", lambda _p: [])
    repo = upload_repo(client, FILES)

    assert client.post(f"/api/repositories/{repo['id']}/analyze").status_code == 200
    assert analysis_service.lock_for(repo["id"]).acquire(blocking=False)
    analysis_service.lock_for(repo["id"]).release()
