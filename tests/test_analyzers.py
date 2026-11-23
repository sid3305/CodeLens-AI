"""Analyzer wrappers: output parsing, failure handling, and real runs."""

import json
import shutil
import subprocess

import pytest

from tests.conftest import FIXTURES
from utils import bandit_analyzer, gitleaks_analyzer, ruff_analyzer, semgrep_analyzer

TARGETS = FIXTURES / "analyzer_targets"


def _fake_run(monkeypatch, module, *, stdout="", stderr="", returncode=0, error=None):
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        if error:
            raise error
        return subprocess.CompletedProcess(args, returncode, stdout, stderr)

    monkeypatch.setattr(module.subprocess, "run", run)
    return calls


RUFF_OUTPUT = [
    {
        "code": "F401",
        "message": "`os` imported but unused",
        "filename": "/repo/a.py",
        "location": {"row": 1, "column": 8},
        "fix": {"message": "Remove unused import"},
    },
    {
        "code": "E501",
        "message": "Line too long",
        "filename": "/repo/a.py",
        "location": {"row": 9, "column": 89},
        "fix": None,
    },
]

BANDIT_OUTPUT = {
    "results": [
        {
            "issue_severity": "HIGH",
            "issue_confidence": "HIGH",
            "filename": "/repo/a.py",
            "line_number": 6,
            "col_offset": 11,
            "test_id": "B602",
            "test_name": "subprocess_popen_with_shell_equals_true",
            "issue_text": "subprocess call with shell=True",
            "more_info": "https://bandit.readthedocs.io/b602",
        }
    ]
}

SEMGREP_OUTPUT = {
    "results": [
        {
            "check_id": "python.lang.security.audit.subprocess-shell-true",
            "path": "/repo/a.py",
            "start": {"line": 6, "col": 12},
            "extra": {"severity": "ERROR", "message": "Found shell=True", "metadata": {}},
        },
        {
            "check_id": "rule.info",
            "path": "/repo/b.py",
            "start": {"line": 1, "col": 1},
            "extra": {"severity": "INFO", "message": "fyi"},
        },
    ],
    "errors": [],
}

GITLEAKS_OUTPUT = [
    {
        "RuleID": "generic-api-key",
        "Description": "Generic API Key",
        "File": "/repo/config.py",
        "StartLine": 3,
        "StartColumn": 10,
        "Secret": "must-not-appear",
        "Match": "API_KEY=must-not-appear",
    }
]


def test_ruff_output_is_parsed(tmp_path, monkeypatch):
    _fake_run(monkeypatch, ruff_analyzer, stdout=json.dumps(RUFF_OUTPUT), returncode=1)

    findings = ruff_analyzer.run_ruff_analysis(tmp_path)

    assert [f["rule_id"] for f in findings] == ["F401", "E501"]
    assert findings[0]["severity"] == "Medium"
    assert findings[0]["recommendation"] == "Remove unused import"
    assert findings[1]["severity"] == "Low"
    assert findings[1]["line"] == 9


def test_bandit_output_is_parsed(tmp_path, monkeypatch):
    _fake_run(monkeypatch, bandit_analyzer, stdout=json.dumps(BANDIT_OUTPUT), returncode=1)

    (finding,) = bandit_analyzer.run_bandit_analysis(tmp_path)

    assert finding["severity"] == "High"
    assert finding["confidence"] == "High"
    assert finding["rule_id"] == "B602"
    assert finding["category"] == "Security"


def test_semgrep_output_is_parsed(tmp_path, monkeypatch):
    calls = _fake_run(
        monkeypatch, semgrep_analyzer, stdout=json.dumps(SEMGREP_OUTPUT), returncode=1
    )

    findings = semgrep_analyzer.run_semgrep_analysis(tmp_path)

    assert [f["severity"] for f in findings] == ["High", "Low"]
    assert "--metrics=off" in calls[0]


def test_gitleaks_output_never_includes_the_secret(tmp_path, monkeypatch):
    _fake_run(monkeypatch, gitleaks_analyzer, stdout=json.dumps(GITLEAKS_OUTPUT), returncode=1)

    (finding,) = gitleaks_analyzer.run_gitleaks_analysis(tmp_path)

    assert finding["severity"] == "High"
    assert finding["line"] == 3
    assert "must-not-appear" not in json.dumps(finding)


ANALYZERS = [
    (ruff_analyzer, ruff_analyzer.run_ruff_analysis),
    (bandit_analyzer, bandit_analyzer.run_bandit_analysis),
    (semgrep_analyzer, semgrep_analyzer.run_semgrep_analysis),
    (gitleaks_analyzer, gitleaks_analyzer.run_gitleaks_analysis),
]


@pytest.mark.parametrize(("module", "run"), ANALYZERS)
def test_missing_tool_is_reported(tmp_path, monkeypatch, module, run):
    _fake_run(monkeypatch, module, error=FileNotFoundError())

    with pytest.raises(RuntimeError, match="not installed"):
        run(tmp_path)


@pytest.mark.parametrize(("module", "run"), ANALYZERS)
def test_timeouts_are_reported(tmp_path, monkeypatch, module, run):
    _fake_run(monkeypatch, module, error=subprocess.TimeoutExpired(["x"], 1))

    with pytest.raises(RuntimeError, match="timed out"):
        run(tmp_path)


@pytest.mark.parametrize(("module", "run"), ANALYZERS)
def test_unparseable_output_is_reported(tmp_path, monkeypatch, module, run):
    _fake_run(monkeypatch, module, stdout="not json", returncode=0)

    with pytest.raises(RuntimeError, match="(?i)parse"):
        run(tmp_path)


@pytest.mark.parametrize(("module", "run"), ANALYZERS)
def test_tool_crashes_are_reported(tmp_path, monkeypatch, module, run):
    _fake_run(monkeypatch, module, stdout="{}", stderr="boom", returncode=2)

    with pytest.raises(RuntimeError, match="(?i)fail"):
        run(tmp_path)


@pytest.mark.parametrize(("module", "run"), ANALYZERS)
def test_missing_target_is_rejected(tmp_path, module, run):
    with pytest.raises(FileNotFoundError):
        run(tmp_path / "missing")


# --- Real tool runs ------------------------------------------------------------


@pytest.mark.skipif(not shutil.which("ruff"), reason="ruff not installed")
def test_real_ruff_run_finds_unused_import():
    findings = ruff_analyzer.run_ruff_analysis(TARGETS / "lint_issues.py")

    assert "F401" in {f["rule_id"] for f in findings}


@pytest.mark.skipif(not shutil.which("bandit"), reason="bandit not installed")
def test_real_bandit_run_finds_shell_injection():
    findings = bandit_analyzer.run_bandit_analysis(TARGETS / "insecure_shell.py")

    assert {"B602", "B105"} <= {f["rule_id"] for f in findings}
