"""
X3: static report export (HTML, JSON, SARIF) built from saved data only.

- Repository-relative paths only; any local path that slips into text is
  replaced (upload store, home directory).
- Code snippets are small, redacted, and never taken from sensitive files.
- The AI summary is included only when it exists and was asked for.
  Exporting never calls an LLM.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services.analysis_service import get_analysis_results
from backend.services.dependency_service import get_dependency_report
from backend.services.fact_sheet import collect_facts, static_summary
from backend.services.repository_service import (
    get_repository,
    get_saved_repository_summary,
    list_repository_files,
)
from utils.config import get_upload_dir
from utils.parser import read_file_content
from utils.security import is_sensitive_file, redact_secrets, resolve_within

TOOL_NAME = "CodeLens AI"
TOOL_VERSION = "1.0.0"
SNIPPET_CONTEXT = 3
MAX_EXPORT_BYTES = 20 * 1024 * 1024
TEMPLATE = Path(__file__).with_name("report_template.html")

SARIF_LEVEL = {"Critical": "error", "High": "error", "Medium": "warning", "Low": "note", "Info": "note"}


def _scrub(value: Any, local_paths: list[str]) -> Any:
    """Redact secrets and remove local absolute paths from every string."""

    if isinstance(value, str):
        text = redact_secrets(value)
        for local in local_paths:
            text = text.replace(local, "<local path>")
        return text
    if isinstance(value, list):
        return [_scrub(item, local_paths) for item in value]
    if isinstance(value, dict):
        return {key: _scrub(item, local_paths) for key, item in value.items()}
    return value


def _snippet(root: str, relative: str, line: int | None) -> dict[str, Any] | None:
    if not relative or not line or is_sensitive_file(relative):
        return None
    try:
        path = resolve_within(root, relative)
    except ValueError:
        return None
    if not path.is_file() or path.stat().st_size > 1024 * 1024:
        return None
    content = read_file_content(str(path))
    if content.startswith("Error reading file:"):
        return None
    lines = content.splitlines()
    if line > len(lines):
        return None
    start = max(1, line - SNIPPET_CONTEXT)
    end = min(len(lines), line + SNIPPET_CONTEXT)
    return {"start_line": start, "text": "\n".join(lines[start - 1:end])}


def build_report(repo_id: str, *, include_summary: bool = False) -> dict[str, Any]:
    repository = get_repository(repo_id)
    root = repository["path"]
    analysis = get_analysis_results(repo_id)
    dependencies = get_dependency_report(repo_id)
    summary = get_saved_repository_summary(repo_id) if include_summary else None

    findings = []
    for finding in (analysis or {}).get("findings", []):
        findings.append({
            "id": finding.get("id"),
            "title": finding.get("title"),
            "severity": finding.get("severity"),
            "category": finding.get("category"),
            "rule_id": finding.get("rule_id"),
            "file": finding.get("file"),
            "line": finding.get("line"),
            "description": finding.get("description"),
            "recommendation": finding.get("recommendation"),
            "detected_by": finding.get("detected_by", []),
            "snippet": _snippet(root, finding.get("file") or "", finding.get("line")),
        })

    report = {
        "format": "codelens-report/1",
        "tool": {"name": TOOL_NAME, "version": TOOL_VERSION},
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repository": {
            "name": repository["name"],
            "source": repository.get("source"),
            "source_url": repository.get("source_url"),
            "ref": repository.get("ref"),
        },
        "files": [item["path"] for item in list_repository_files(repo_id)["files"]],
        "analysis": None if analysis is None else {
            "status": analysis.get("status"),
            "analyzed_at": analysis.get("analyzed_at"),
            "summary": analysis.get("summary"),
            "tool_status": {
                name: {"status": status.get("status"), "findings": status.get("findings")}
                for name, status in (analysis.get("tool_status") or {}).items()
            },
        },
        "findings": findings,
        "dependencies": {
            key: dependencies.get(key, [])
            for key in (
                "analyzed_files", "module_dependencies", "external_dependencies", "stdlib_imports",
                "unresolved_imports", "skipped_files", "circular_dependencies",
            )
        },
        # Always present: written from the facts, no AI.
        "static_summary": static_summary(collect_facts(repo_id, repository)),
        "ai_summary": None if not summary else {
            "text": summary.get("summary"),
            "generated_at": summary.get("generated_at"),
        },
        "notes": [],
    }

    local_paths = sorted({str(Path(root)), str(Path(root).resolve()), str(get_upload_dir()), str(Path.home())}, key=len, reverse=True)
    report = _scrub(report, local_paths)

    # Size guard: drop snippets (largest part) if the file would be too big.
    if len(json.dumps(report)) > MAX_EXPORT_BYTES:
        for finding in report["findings"]:
            finding["snippet"] = None
        report["notes"].append("Code snippets were left out to keep this file under 20 MB.")
    return report


def to_sarif(report: dict[str, Any]) -> dict[str, Any]:
    rules: dict[str, dict[str, Any]] = {}
    results = []
    for finding in report["findings"]:
        rule_id = finding.get("rule_id") or "unspecified"
        rules.setdefault(rule_id, {"id": rule_id, "shortDescription": {"text": finding.get("title") or rule_id}})
        location: dict[str, Any] = {"artifactLocation": {"uri": finding.get("file") or ""}}
        if finding.get("line"):
            location["region"] = {"startLine": finding["line"]}
        results.append({
            "ruleId": rule_id,
            "level": SARIF_LEVEL.get(finding.get("severity") or "", "warning"),
            "message": {"text": finding.get("description") or finding.get("title") or rule_id},
            "locations": [{"physicalLocation": location}],
            "properties": {"severity": finding.get("severity"), "detectedBy": finding.get("detected_by", [])},
        })
    return {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {"driver": {"name": TOOL_NAME, "version": TOOL_VERSION, "rules": list(rules.values())}},
            "results": results,
        }],
    }


def to_html(report: dict[str, Any]) -> str:
    # Embedded as JSON in a <script type="application/json">: "<" is escaped
    # so no text in the data can close the tag.
    data = json.dumps(report).replace("<", "\\u003c")
    title = re.sub(r"[<>&\"']", "", f"{report['repository']['name']} · CodeLens AI report")
    return TEMPLATE.read_text(encoding="utf-8").replace("{{TITLE}}", title).replace("{{DATA}}", data)
