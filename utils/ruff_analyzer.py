
import json
import subprocess
from pathlib import Path


def run_ruff_analysis(target_path):
    """
    Run Ruff against a file or repository directory.
    Returns normalized findings.
    """

    target_path = Path(target_path).resolve()

    if not target_path.exists():
        raise FileNotFoundError(f"Path does not exist: {target_path}")

    command = [
        "ruff",
        "check",
        str(target_path),
        "--output-format",
        "json"
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=120,
            check=False
        )

    except FileNotFoundError:
        raise RuntimeError("Ruff is not installed or is not available on PATH.")

    except subprocess.TimeoutExpired:
        raise RuntimeError("Ruff analysis timed out.")

    if result.returncode not in (0, 1):
        raise RuntimeError(
            f"Ruff failed:\n{result.stderr or result.stdout}"
        )

    try:
        raw_findings = json.loads(result.stdout or "[]")
    except json.JSONDecodeError:
        raise RuntimeError("Could not parse Ruff's JSON output.")

    findings = []

    for item in raw_findings:
        location = item.get("location", {})
        code = item.get("code", "UNKNOWN")

        # Ruff reports lint diagnostics, not vulnerability severity.
        severity = "Medium" if code.startswith(
            ("F", "B", "S")
        ) else "Low"

        findings.append({
            "tool": "Ruff",
            "category": "Code Quality",
            "severity": severity,
            "file": item.get("filename", ""),
            "line": location.get("row"),
            "column": location.get("column"),
            "rule_id": code,
            "title": item.get("message", "Code issue detected"),
            "description": item.get("message", ""),
            "recommendation": (
                item.get("fix", {}).get("message")
                if item.get("fix")
                else "Review this issue and update the code."
            )
        })

    return findings
