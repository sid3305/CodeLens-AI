"""
Background jobs (B3): import, analysis and dependency analysis run off the
request thread, with status, progress and cooperative cancel. Clients poll
GET /api/jobs/{id}.

Jobs live in memory: a backend restart forgets them (the work they
finished is saved by the services themselves).
"""

import logging
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

ACTIVE = {"queued", "running"}
KEEP_FINISHED = 200
UNEXPECTED_ERROR = "The job failed unexpectedly. See the server log."


class JobCancelled(Exception):
    """Raised by JobContext.check() once a cancel was requested."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Job:
    id: str
    kind: str
    repository_id: str | None
    status: str = "queued"
    progress: float | None = None
    message: str = "Waiting to start"
    result: Any = None
    error: str | None = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    cancel_requested: threading.Event = field(default_factory=threading.Event, repr=False)

    @property
    def active(self) -> bool:
        return self.status in ACTIVE

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "repository_id": self.repository_id,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class JobContext:
    """Handed to the work function: report progress, honour cancel."""

    def __init__(self, manager: "JobManager", job: Job):
        self._manager = manager
        self._job = job

    @property
    def cancelled(self) -> bool:
        return self._job.cancel_requested.is_set()

    def check(self) -> None:
        if self.cancelled:
            raise JobCancelled()

    def progress(self, fraction: float | None, message: str) -> None:
        self.check()
        self._manager._update(self._job, progress=fraction, message=message)

    def set_repository(self, repository_id: str) -> None:
        """Imports learn their repository id only once it exists."""
        self._manager._update(self._job, repository_id=repository_id)


class JobManager:
    def __init__(self, max_workers: int = 3):
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="codelens-job")
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def _update(self, job: Job, **changes: Any) -> None:
        with self._lock:
            for key, value in changes.items():
                setattr(job, key, value)
            job.updated_at = _now()

    def submit(
        self,
        kind: str,
        repository_id: str | None,
        work: Callable[[JobContext], Any],
        *,
        on_error: Callable[[Exception], str | None] | None = None,
    ) -> Job:
        """
        Queue work, or return the active job of the same kind for the same
        repository (one analysis per repository at a time, and so on).
        """

        with self._lock:
            if repository_id is not None:
                for existing in self._jobs.values():
                    if existing.active and existing.kind == kind and existing.repository_id == repository_id:
                        return existing
            job = Job(id=uuid.uuid4().hex, kind=kind, repository_id=repository_id)
            self._jobs[job.id] = job
            self._forget_old()

        self._executor.submit(self._run, job, work, on_error)
        return job

    def _run(self, job: Job, work, on_error) -> None:
        if job.cancel_requested.is_set():
            self._update(job, status="cancelled", message="Cancelled")
            return
        self._update(job, status="running", message="Starting")
        context = JobContext(self, job)
        try:
            result = work(context)
            context.check()
        except JobCancelled:
            self._update(job, status="cancelled", message="Cancelled")
            return
        except Exception as error:  # reported on the job
            message = on_error(error) if on_error else None
            if message is None:
                message = str(error) if isinstance(error, ValueError) else UNEXPECTED_ERROR
            if message == UNEXPECTED_ERROR:
                logger.exception("%s job %s failed", job.kind, job.id)
            self._update(job, status="failed", error=message, message="Failed")
            return
        self._update(job, status="succeeded", result=result, progress=1.0, message="Done")

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self, *, repository_id: str | None = None, active: bool | None = None) -> list[Job]:
        with self._lock:
            jobs = list(self._jobs.values())
        if repository_id is not None:
            jobs = [job for job in jobs if job.repository_id == repository_id]
        if active is not None:
            jobs = [job for job in jobs if job.active == active]
        return sorted(jobs, key=lambda job: job.created_at)

    def cancel(self, job_id: str) -> Job | None:
        job = self.get(job_id)
        if job and job.active:
            job.cancel_requested.set()
            self._update(job, message="Cancelling…")
        return job

    def _forget_old(self) -> None:
        """Keep the most recent finished jobs only (called with the lock held)."""
        finished = sorted((job for job in self._jobs.values() if not job.active), key=lambda item: item.updated_at)
        for job in finished[: max(0, len(finished) - KEEP_FINISHED)]:
            del self._jobs[job.id]


jobs = JobManager()
