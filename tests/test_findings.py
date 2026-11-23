"""Finding normalisation, severity mapping and de-duplication."""

import pytest

from utils.analysis_engine import run_all_analyzers
from utils.finding_deduplicator import deduplicate_findings, get_vulnerability_family
from utils.finding_normalizer import normalize_finding, normalize_findings
from utils.severity_classifier import (
    get_highest_confidence,
    get_highest_severity,
    normalize_confidence,
    normalize_severity,
)


def _raw(tool, rule, line, *, file="app/a.py", severity="Medium", category="Security", **extra):
    return {
        "tool": tool,
        "rule_id": rule,
        "file": file,
        "line": line,
        "severity": severity,
        "category": category,
        "title": f"{tool} {rule}",
        "description": extra.pop("description", ""),
        **extra,
    }


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("CRITICAL", "Critical"),
        ("high", "High"),
        ("ERROR", "High"),
        ("Warning", "Medium"),
        ("low", "Low"),
        ("informational", "Info"),
        ("weird", "Info"),
        (None, "Info"),
    ],
)
def test_severity_normalisation(value, expected):
    assert normalize_severity("Tool", value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [("HIGH", "High"), ("medium", "Medium"), ("low", "Low"), ("?", "Not assessed"), (None, "Not assessed")],
)
def test_confidence_normalisation(value, expected):
    assert normalize_confidence("Tool", value) == expected


def test_highest_severity_and_confidence():
    assert get_highest_severity(["Low", "Critical", "Medium"]) == "Critical"
    assert get_highest_severity(["bogus"]) == "Info"
    assert get_highest_confidence(["Low", "Not assessed", "High"]) == "High"
    assert get_highest_confidence(["Not assessed"]) == "Not assessed"


def test_normalised_finding_shape_and_stable_id():
    finding = normalize_finding(
        _raw("Bandit", "B602", 6, file="app\\a.py", confidence="HIGH", cwe="CWE-78")
    )

    assert finding["file"] == "app/a.py"
    assert finding["severity"] == "Medium"
    assert finding["confidence"] == "High"
    assert finding["cwe"] == ["CWE-78"]
    assert finding["detected_by"] == ["Bandit"]
    assert finding["id"] == normalize_finding(
        _raw("Bandit", "B602", 6, file="app\\a.py", confidence="HIGH", cwe="CWE-78")
    )["id"]


def test_same_vulnerability_from_two_tools_is_merged():
    findings = normalize_findings(
        [
            _raw("Bandit", "B602", 6, severity="High", confidence="HIGH"),
            _raw(
                "Semgrep",
                "python.lang.security.audit.subprocess-shell-true",
                6,
                severity="ERROR",
            ),
        ]
    )

    (merged,) = deduplicate_findings(findings)

    assert set(merged["detected_by"]) == {"Bandit", "Semgrep"}
    assert merged["severity"] == "High"
    assert merged["duplicate_count"] == 1
    assert len(merged["tool_details"]) == 2


@pytest.mark.parametrize(
    "second",
    [
        _raw("Semgrep", "x.subprocess-shell-true", 6, file="app/other.py"),
        _raw("Semgrep", "x.subprocess-shell-true", 40),
        _raw("Semgrep", "x.subprocess-shell-true", 6, category="Code Quality"),
    ],
    ids=["different-file", "different-line", "different-category"],
)
def test_unrelated_findings_are_not_merged(second):
    findings = normalize_findings([_raw("Bandit", "B602", 6), second])

    assert len(deduplicate_findings(findings)) == 2


def test_ruff_findings_are_never_merged():
    findings = normalize_findings(
        [
            _raw("Ruff", "F401", 1, category="Code Quality"),
            _raw("Ruff", "F401", 1, category="Code Quality"),
        ]
    )

    assert len(deduplicate_findings(findings)) == 2


@pytest.mark.parametrize(
    ("rule", "text", "family"),
    [
        ("B307", "", "dynamic-code-execution"),
        ("B303", "", "weak-md5-hashing"),
        ("B301", "", "unsafe-deserialization"),
        ("B506", "", "unsafe-yaml-loading"),
        ("B608", "", "sql-injection"),
        ("x", "tainted-sql-string", "sql-injection"),
        ("x", "nothing special", None),
    ],
)
def test_vulnerability_families(rule, text, family):
    assert get_vulnerability_family({"rule_id": rule, "description": text}) == family


def test_engine_isolates_failing_analyzers(tmp_path, monkeypatch):
    import utils.analysis_engine as engine

    monkeypatch.setattr(
        engine, "run_ruff_analysis", lambda _p: [_raw("Ruff", "F401", 1, category="Code Quality")]
    )
    monkeypatch.setattr(engine, "run_bandit_analysis", lambda _p: "not a list")

    def missing(_path):
        raise RuntimeError("not installed")

    monkeypatch.setattr(engine, "run_semgrep_analysis", missing)
    monkeypatch.setattr(engine, "run_gitleaks_analysis", lambda _p: [])

    result = run_all_analyzers(str(tmp_path))

    assert result["total_findings"] == 1
    assert result["tool_status"]["Ruff"]["status"] == "Completed"
    assert result["tool_status"]["Bandit"]["status"] == "Failed"
    assert "invalid findings format" in result["tool_status"]["Bandit"]["error"]
    assert result["tool_status"]["Semgrep"]["error"] == "not installed"
