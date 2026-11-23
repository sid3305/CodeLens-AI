"""
The frontend tree tests check per-file counts against real backend reports
(frontend/src/test/fixtures/dependency-reports.json). This keeps that file
in step with the analysis: re-run scripts/export_dependency_fixtures.py.
"""

import json

from scripts.export_dependency_fixtures import OUTPUT, export


def test_frontend_dependency_fixtures_are_current():
    committed = json.loads(OUTPUT.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(export())), (
        "Re-run: python scripts/export_dependency_fixtures.py"
    )


def test_frontend_dependency_fixtures_hold_only_relative_paths():
    text = OUTPUT.read_text(encoding="utf-8")
    assert ":\\\\" not in text and "/home/" not in text and "/Users/" not in text
