
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from utils.security import redact_secrets

from utils.analysis_engine import run_all_analyzers
from utils.config import get_upload_dir

from backend.services.repository_service import get_repository


_analysis_lock = Lock()

def _sanitize_finding_data(value):
    """Redact secrets recursively from finding data."""

    if isinstance(value, dict):
        return {
            key: _sanitize_finding_data(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [
            _sanitize_finding_data(item)
            for item in value
        ]

    if isinstance(value, str):
        return redact_secrets(value)

    return value


def _results_file(repo_id):
    """Get the persistent results file for a repository."""

    upload_root = get_upload_dir()
    workspace = (upload_root / repo_id).resolve()

    try:
        workspace.relative_to(upload_root)
    except ValueError:
        raise ValueError("Invalid repository workspace.")

    return workspace / "analysis_results.json"


def _make_relative_paths(findings, repo_path):
    """Remove absolute local paths from findings."""

    for finding in findings:
        raw_path = finding.get("file")

        if not raw_path:
            continue

        try:
            path = Path(raw_path).resolve()
            finding["file"] = path.relative_to(repo_path).as_posix()
        except (ValueError, OSError):
            finding["file"] = Path(raw_path).name

    return findings


def _build_summary(result):
    """Calculate dashboard summary statistics."""

    findings = result["findings"]

    severity_counts = Counter()
    category_counts = Counter()
    tool_counts = Counter()

    for finding in findings:
        severity_counts[finding.get("severity", "Unknown")] += 1
        category_counts[finding.get("category", "General")] += 1

        for tool in finding.get("detected_by", []):
            tool_counts[tool] += 1

    return {
        "total_findings": len(findings),
        "raw_total_findings": result["raw_total_findings"],
        "duplicates_removed": result["duplicates_removed"],
        "severity_counts": dict(severity_counts),
        "category_counts": dict(category_counts),
        "tool_counts": dict(tool_counts),
    }


def _overall_status(tool_status):
    """
    Summarise analyzer outcomes.

    "completed" only when every analyzer ran; "partial" when some failed
    (typically because the tool is not installed); "failed" when none ran.
    """

    statuses = [
        str(item.get("status", "")).lower()
        for item in tool_status.values()
    ]
    completed = statuses.count("completed")

    if statuses and completed == len(statuses):
        return "completed"

    if completed:
        return "partial"

    return "failed"


def analyze_repository(repo_id):
    """Run all existing analyzers against a repository."""

    repository = get_repository(repo_id)
    repo_path = Path(repository["path"]).resolve()

    results_path = _results_file(repo_id)

    # Prevent simultaneous analysis runs for different repositories
    # from being blocked by holding a global lock during scanning.
    if not _analysis_lock.acquire(blocking=False):
        raise RuntimeError("Another repository analysis is currently running.")

    try:
        result = run_all_analyzers(str(repo_path))

        findings = _make_relative_paths(
            result["findings"],
            repo_path,
        )

        findings = _sanitize_finding_data(findings)

        analyzed_at = datetime.now(timezone.utc).isoformat()

        response = {
            "repository_id": repo_id,
            "repository_name": repository["name"],
            "status": _overall_status(result["tool_status"]),
            "analyzed_at": analyzed_at,
            "summary": _build_summary(result),
            "tool_status": result["tool_status"],
            "findings": findings,
        }

        results_path.parent.mkdir(parents=True, exist_ok=True)

        temporary_path = results_path.with_suffix(".tmp")

        with temporary_path.open("w", encoding="utf-8") as file:
            json.dump(response, file, indent=2)

        temporary_path.replace(results_path)

        return response

    finally:
        _analysis_lock.release()


def get_analysis_results(repo_id):
    """Retrieve the latest saved analysis results."""

    get_repository(repo_id)

    results_path = _results_file(repo_id)

    if not results_path.exists():
        raise ValueError("No analysis results found. Run an analysis first.")

    try:
        with results_path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError):
        raise RuntimeError("Unable to read the saved analysis results.")
