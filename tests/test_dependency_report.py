"""B1: manifest parsing and the assembled dependency report."""

from pathlib import Path

import pytest

from tests.conftest import FIXTURES
from utils.code_graph.dependencies import (
    MANIFEST_PATTERNS,
    build_dependency_report,
    parse_package_json,
    parse_pyproject_toml,
    parse_requirements_txt,
)
from utils.code_graph.import_graph import build_import_graph
from utils.file_handler import get_code_files

REPOS = FIXTURES / "dependency_repos"


def report_for(name):
    root = REPOS / name
    files = [
        Path(p).relative_to(root).as_posix()
        for p in get_code_files(root, include_patterns=MANIFEST_PATTERNS)
    ]
    return build_dependency_report("repo", root, files, build_import_graph(root, files))


@pytest.mark.parametrize(
    ("line", "name", "version"),
    [
        ("requests", "requests", None),
        ("requests==2.31.0", "requests", "==2.31.0"),
        ("uvicorn[standard]==0.54.0", "uvicorn", "==0.54.0"),
        ("semgrep==1.0; sys_platform != 'win32'", "semgrep", "==1.0"),
        ("Django >= 4.2, < 5", "Django", ">= 4.2, < 5"),
        ("pkg~=1.4  # pinned for reasons", "pkg", "~=1.4"),
    ],
)
def test_requirement_lines(line, name, version):
    assert parse_requirements_txt(line) == [{"name": name, "version": version}]


@pytest.mark.parametrize("line", ["", "# comment", "-r base.txt", "--index-url https://x"])
def test_requirement_lines_without_packages(line):
    assert parse_requirements_txt(line) == []


def test_pyproject_pep621_and_poetry():
    content = """
[project]
dependencies = ["fastapi>=0.100", "uvicorn[standard]"]

[project.optional-dependencies]
test = ["pytest==8.0"]

[tool.poetry.dependencies]
python = "^3.10"
rich = "^13"

[tool.poetry.dev-dependencies]
black = {version = "^24"}
"""
    parsed = parse_pyproject_toml(content)

    assert parsed["dependencies"] == {"fastapi": ">=0.100", "uvicorn": None, "rich": "^13"}
    assert parsed["dev_dependencies"] == {"pytest": "==8.0", "black": None}


def test_invalid_manifests_are_ignored():
    assert parse_pyproject_toml("not = [valid") == {"dependencies": {}, "dev_dependencies": {}}
    assert parse_package_json("{not json") == {}
    assert parse_package_json("[]") == {}


def test_imports_and_manifests_merge_into_one_package():
    report = report_for("py_collisions")
    packages = {p["name"]: p for p in report["external_dependencies"]}

    assert packages["pyyaml"]["declared"] is True
    assert packages["pyyaml"]["version"] == "==6.0.1"
    assert packages["pyyaml"]["import_count"] == 1
    assert packages["pyyaml"]["source_files"] == ["main.py", "requirements.txt"]
    assert packages["numpy"]["declared"] is False


def test_npm_manifest_versions_and_dev_flags():
    report = report_for("npm_scoped")
    packages = {p["name"]: p for p in report["external_dependencies"]}

    assert packages["@scope/pkg"]["version"] == "^1.0.0"
    assert packages["@scope/pkg"]["is_dev_dependency"] is False
    assert packages["vitest"]["is_dev_dependency"] is True
    assert packages["vitest"]["import_count"] == 0
    assert packages["express"]["declared"] is False


def test_report_shape_on_cycles_fixture():
    report = report_for("py_cycles")

    cycle = next(c for c in report["circular_dependencies"] if len(c["files"]) == 3)
    assert cycle["severity"] == "high"
    assert cycle["description"].startswith("Circular import chain: pkg/c.py -> ")
    edge = next(
        m for m in report["module_dependencies"]
        if (m["source_module"], m["target_module"]) == ("pkg/d.py", "pkg/e.py")
    )
    assert edge["imports"] == ["thing"]
    assert report["stats"]["circular_import_count"] == 3
    assert report["language_breakdown"]["python"]["files"] == 8


def test_unresolved_and_skipped_are_reported():
    assert [s["path"] for s in report_for("py_syntax_error")["skipped_files"]] == ["broken.py"]

    unresolved = report_for("py_relative")["unresolved_imports"]
    assert {u["specifier"] for u in unresolved} == {".missing_module", "...."}
    assert all(u["reason"] for u in unresolved)


def test_empty_repository_report():
    report = report_for("empty")

    assert report["total_internal_modules"] == 0
    assert report["circular_dependencies"] == []
    assert report["external_dependencies"] == []
    assert report["stats"]["total_imports"] == 0
