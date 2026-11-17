
import hashlib
import re

from utils.severity_classifier import (
    get_highest_severity,
    get_highest_confidence
)


def get_vulnerability_family(finding):
    """
    Identify known vulnerability families using analyzer rule IDs
    and finding descriptions.
    """

    tool = finding.get("tool", "")
    rule = str(finding.get("rule_id", "")).lower()
    title = str(finding.get("title", "")).lower()
    description = str(finding.get("description", "")).lower()

    text = f"{rule} {title} {description}"

    # Command injection / unsafe shell execution
    if (
        rule == "b602"
        or "subprocess-shell-true" in text
        or "shell_equals_true" in text
    ):
        return "command-injection"

    # Dynamic code execution
    if (
        rule == "b307"
        or "eval-detected" in text
        or "eval-injection" in text
        or "user-eval" in text
    ):
        return "dynamic-code-execution"

    # Weak MD5 hashing
    if (
        rule == "b303"
        or "md5-used-as-password" in text
    ):
        return "weak-md5-hashing"

    # Unsafe pickle deserialization
    if (
        rule == "b301"
        or "avoid-pickle" in text
        or "insecure-deserialization" in text
    ):
        return "unsafe-deserialization"

    # Unsafe YAML loading
    if (
        rule == "b506"
        or "avoid-pyyaml-load" in text
        or "yaml_load" in text
    ):
        return "unsafe-yaml-loading"

    # SQL injection
    if (
        rule == "b608"
        or "sql-injection" in text
        or "tainted-sql-string" in text
        or "execute-raw-query" in text
    ):
        return "sql-injection"

    return None


def locations_overlap(first, second):
    """Check whether two findings overlap in source location."""

    first_start = first.get("line")
    second_start = second.get("line")

    if first_start is None or second_start is None:
        return False

    first_end = first.get("end_line") or first_start
    second_end = second.get("end_line") or second_start

    return (
        first_start <= second_end
        and second_start <= first_end
    )


def can_merge(first, second):
    """
    Decide whether two findings represent the same issue.

    Ruff code-quality findings are not merged with security findings.
    """

    if first.get("file", "").lower() != second.get("file", "").lower():
        return False

    if not locations_overlap(first, second):
        return False

    if first.get("category") != second.get("category"):
        return False

    # Do not consolidate separate Ruff lint diagnostics.
    if "Ruff" in first.get("detected_by", []):
        return False

    if "Ruff" in second.get("detected_by", []):
        return False

    first_family = get_vulnerability_family(
        first["tool_details"][0]
    )

    second_family = get_vulnerability_family(
        second["tool_details"][0]
    )

    if first_family and first_family == second_family:
        return True

    # Fallback: same rule and overlapping location.
    # Only merge when the rule identifiers are identical.
    first_rules = {
        item.get("rule_id")
        for item in first.get("tool_details", [])
    }

    second_rules = {
        item.get("rule_id")
        for item in second.get("tool_details", [])
    }

    return bool(first_rules & second_rules)


def create_group_id(finding):
    """Create a deterministic ID for a consolidated issue."""

    family = get_vulnerability_family(
        finding["tool_details"][0]
    ) or finding.get("rule_id", "unknown")

    identity = "|".join([
        finding.get("file", ""),
        str(finding.get("line")),
        str(finding.get("end_line")),
        str(family)
    ])

    return hashlib.sha256(
        identity.encode("utf-8")
    ).hexdigest()[:16]


def merge_findings(group):
    """Combine multiple analyzer reports into one issue."""

    first = group[0]

    details = []
    detected_by = []

    for finding in group:
        for detail in finding.get("tool_details", []):
            if detail not in details:
                details.append(detail)

        for tool in finding.get("detected_by", []):
            if tool not in detected_by:
                detected_by.append(tool)

    severities = [
        finding.get("severity", "Info")
        for finding in group
    ]

    confidences = [
        finding.get("confidence", "Not assessed")
        for finding in group
    ]

    result = dict(first)

    result.update({
        "id": create_group_id(first),
        "severity": get_highest_severity(severities),
        "confidence": get_highest_confidence(confidences),
        "detected_by": detected_by,
        "tool_details": details,
        "duplicate_count": len(group) - 1
    })

    return result


def deduplicate_findings(findings):
    """
    Consolidate duplicate findings while retaining original tool evidence.
    """

    groups = []

    for finding in findings:

        matched_group = None

        for group in groups:
            if can_merge(group[0], finding):
                matched_group = group
                break

        if matched_group is not None:
            matched_group.append(finding)
        else:
            groups.append([finding])

    return [
        merge_findings(group)
        for group in groups
    ]
