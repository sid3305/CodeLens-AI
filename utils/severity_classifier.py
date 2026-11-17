
SEVERITY_ORDER = {
    "Info": 0,
    "Low": 1,
    "Medium": 2,
    "High": 3,
    "Critical": 4
}

CONFIDENCE_ORDER = {
    "Not assessed": -1,
    "Low": 0,
    "Medium": 1,
    "High": 2
}


def normalize_severity(tool, original_severity, category=None):
    """
    Normalize severity while preserving the original analyzer assessment.
    """

    if not original_severity:
        return "Info"

    severity = str(original_severity).strip().lower()

    severity_map = {
        "critical": "Critical",
        "high": "High",
        "error": "High",
        "medium": "Medium",
        "warning": "Medium",
        "low": "Low",
        "info": "Info",
        "informational": "Info"
    }

    return severity_map.get(severity, "Info")


def normalize_confidence(tool, original_confidence=None):
    """
    Normalize analyzer-provided confidence.

    Do not invent confidence when the analyzer does not provide it.
    """

    if not original_confidence:
        return "Not assessed"

    confidence = str(original_confidence).strip().lower()

    confidence_map = {
        "high": "High",
        "medium": "Medium",
        "low": "Low"
    }

    return confidence_map.get(confidence, "Not assessed")


def get_highest_severity(severities):
    """
    Return the highest severity among consolidated findings.
    """

    valid = [
        severity for severity in severities
        if severity in SEVERITY_ORDER
    ]

    if not valid:
        return "Info"

    return max(valid, key=lambda x: SEVERITY_ORDER[x])


def get_highest_confidence(confidences):
    """
    Return the highest available analyzer confidence.

    Not assessed values are ignored when actual confidence exists.
    """

    valid = [
        confidence for confidence in confidences
        if confidence in CONFIDENCE_ORDER
        and confidence != "Not assessed"
    ]

    if not valid:
        return "Not assessed"

    return max(valid, key=lambda x: CONFIDENCE_ORDER[x])
