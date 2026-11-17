
import json
import subprocess
from pathlib import Path


def run_semgrep_analysis(target_path):
    """
    Run Semgrep OSS against a file or repository directory.
    Returns normalized findings.
    """

    target_path = Path(target_path).resolve()

    if not target_path.exists():
        raise FileNotFoundError(f"Path does not exist: {target_path}")

    command = [
        "semgrep",
        "scan",
        "--config", "p/default",
        "--json",
        "--metrics=off",
        str(target_path)
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
            check=False
        )

    except FileNotFoundError:
        raise RuntimeError("Semgrep is not installed or unavailable on PATH.")

    except subprocess.TimeoutExpired:
        raise RuntimeError("Semgrep analysis timed out.")

    try:
        report = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        raise RuntimeError(
            f"Could not parse Semgrep output:\n{result.stderr}"
        )

    if result.returncode not in (0, 1):
        errors = report.get("errors", [])
        raise RuntimeError(
            f"Semgrep failed: {errors or result.stderr}"
        )

    severity_map = {
        "ERROR": "High",
        "WARNING": "Medium",
        "INFO": "Low"
    }

    findings = []

    for item in report.get("results", []):
        extra = item.get("extra", {})
        start = item.get("start", {})

        original_severity = extra.get("severity", "INFO").upper()

        findings.append({
            "tool": "Semgrep",
            "category": "Security",
            "severity": severity_map.get(original_severity, "Low"),
            "file": item.get("path", ""),
            "line": start.get("line"),
            "column": start.get("col"),
            "rule_id": item.get("check_id", "UNKNOWN"),
            "title": item.get("check_id", "Code issue detected"),
            "description": extra.get("message", ""),
            "recommendation": (
                extra.get("metadata", {}).get("fix")
                or "Review the finding and apply the recommended secure coding practice."
            )
        })

    return findings
