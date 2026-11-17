
import json
import subprocess
from pathlib import Path


def run_bandit_analysis(target_path):
    """
    Run Bandit against a Python file or repository directory.
    Returns normalized security findings.
    """

    target_path = Path(target_path).resolve()

    if not target_path.exists():
        raise FileNotFoundError(f"Path does not exist: {target_path}")

    command = [
        "bandit",
        "-r",
        str(target_path),
        "-f",
        "json",
        "-q"
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
        raise RuntimeError("Bandit is not installed or unavailable on PATH.")

    except subprocess.TimeoutExpired:
        raise RuntimeError("Bandit analysis timed out.")

    # Bandit returns 1 when it finds issues.
    if result.returncode not in (0, 1):
        raise RuntimeError(
            f"Bandit failed:\n{result.stderr or result.stdout}"
        )

    try:
        report = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        raise RuntimeError("Could not parse Bandit's JSON output.")

    findings = []

    for item in report.get("results", []):
        findings.append({
            "tool": "Bandit",
            "category": "Security",
            "severity": item.get("issue_severity", "Low").capitalize(),
            "confidence": item.get("issue_confidence", "Low").capitalize(),
            "file": item.get("filename", ""),
            "line": item.get("line_number"),
            "column": item.get("col_offset"),
            "rule_id": item.get("test_id", "UNKNOWN"),
            "title": item.get("test_name", "Security issue detected"),
            "description": item.get("issue_text", ""),
            "recommendation": (
                item.get("more_info")
                or "Review the flagged code and apply a secure alternative."
            )
        })

    return findings
