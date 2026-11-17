
import json
import subprocess
from pathlib import Path


def run_gitleaks_analysis(target_path):
    """
    Run Gitleaks against a file or repository directory.
    Returns normalized secret-detection findings.
    """

    target_path = Path(target_path).resolve()

    if not target_path.exists():
        raise FileNotFoundError(f"Path does not exist: {target_path}")

    command = [
        "gitleaks",
        "dir",
        "--report-format", "json",
        "--report-path", "-",
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
        raise RuntimeError("Gitleaks is not installed or unavailable on PATH.")

    except subprocess.TimeoutExpired:
        raise RuntimeError("Gitleaks analysis timed out.")

    if result.returncode not in (0, 1):
        raise RuntimeError(
            f"Gitleaks failed:\n{result.stderr or result.stdout}"
        )

    try:
        report = json.loads(result.stdout or "[]")
    except json.JSONDecodeError:
        raise RuntimeError(
            f"Could not parse Gitleaks JSON output:\n{result.stderr}"
        )

    findings = []

    for item in report:
        findings.append({
            "tool": "Gitleaks",
            "category": "Secret Detection",
            "severity": "High",
            "file": item.get("File", ""),
            "line": item.get("StartLine"),
            "column": item.get("StartColumn"),
            "rule_id": item.get("RuleID", "UNKNOWN"),
            "title": item.get("Description", "Potential secret detected"),
            "description": (
                f"Potential exposed secret detected by rule "
                f"{item.get('RuleID', 'UNKNOWN')}."
            ),
            "recommendation": (
                "Revoke or rotate the exposed credential, remove it from "
                "the repository, and use environment-based secret management."
            )
        })

    return findings
