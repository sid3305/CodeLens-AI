"""
Export the dependency reports of the test fixture repositories for the
frontend tests (frontend/src/test/fixtures/dependency-reports.json).

The tree view's per-file counts are checked against these real reports,
so re-run this after changing the dependency analysis:

    python scripts/export_dependency_fixtures.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.services.dependency_service import compute_dependency_report
from utils.file_handler import get_code_files

FIXTURES = ROOT / "tests" / "fixtures" / "dependency_repos"
OUTPUT = ROOT / "frontend" / "src" / "test" / "fixtures" / "dependency-reports.json"
REPOSITORIES = ["py_cycles", "js_cycles", "py_relative", "ts_paths", "npm_scoped", "py_src_layout"]


def export() -> dict:
    reports = {}
    for name in REPOSITORIES:
        root = FIXTURES / name
        report = compute_dependency_report(name, root)
        # Only what the tree view reads; volatile and bulky fields are dropped.
        reports[name] = {
            "files": sorted(Path(p).relative_to(root).as_posix() for p in get_code_files(root)),
            "report": {
                key: report[key]
                for key in (
                    "module_dependencies",
                    "external_dependencies",
                    "stdlib_imports",
                    "analyzed_files",
                    "unresolved_imports",
                    "skipped_files",
                    "circular_dependencies",
                )
            },
        }
    return reports


if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(export(), indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}")
