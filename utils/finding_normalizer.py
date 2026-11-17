
import hashlib
import re

from utils.severity_classifier import (
    normalize_severity,
    normalize_confidence
)


def extract_cwe(finding):
    """Extract CWE information when available."""

    cwe = finding.get("cwe")

    if isinstance(cwe, list):
        return cwe

    if cwe:
        return [cwe]

    return []


def normalize_finding(finding):
    """
    Convert an analyzer finding into a common CodeLens AI schema.
    """

    tool = finding.get("tool", "Unknown")

    original_severity = finding.get(
        "original_severity", finding.get("severity")
    )

    original_confidence = finding.get(
        "original_confidence", finding.get("confidence")
    )

    severity = normalize_severity(
        tool,
        original_severity,
        finding.get("category")
    )

    confidence = normalize_confidence(
        tool,
        original_confidence
    )

    file_path = str(finding.get("file", "")).replace("\\", "/")

    line = finding.get("line")

    end_line = finding.get("end_line", line)

    rule_id = finding.get("rule_id", "UNKNOWN")

    title = finding.get("title", "Code issue detected")

    description = finding.get("description", "")

    recommendation = finding.get("recommendation", "")

    identity = "|".join([
        tool,
        file_path,
        str(line),
        str(rule_id),
        str(title)
    ])

    finding_id = hashlib.sha256(
        identity.encode("utf-8")
    ).hexdigest()[:16]

    return {
        "id": finding_id,

        "title": title,
        "category": finding.get("category", "General"),

        "severity": severity,
        "confidence": confidence,

        "original_severity": original_severity,
        "original_confidence": original_confidence,

        "file": file_path,
        "line": line,
        "end_line": end_line,
        "column": finding.get("column"),

        "rule_id": rule_id,
        "cwe": extract_cwe(finding),

        "description": description,
        "recommendation": recommendation,

        "reference": finding.get("reference"),

        "detected_by": [tool],

        "tool_details": [
            {
                "tool": tool,
                "rule_id": rule_id,
                "original_severity": original_severity,
                "original_confidence": original_confidence,
                "title": title,
                "description": description,
                "recommendation": recommendation,
                "reference": finding.get("reference")
            }
        ]
    }


def normalize_findings(findings):
    """Normalize a list of findings."""

    return [
        normalize_finding(finding)
        for finding in findings
    ]
