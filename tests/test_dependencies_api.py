"""
Dependency analysis endpoints.

The smoke tests pin the response contract. The strict xfail tests record
known accuracy bugs from PROJECT_REVIEW.md; Stage 2 (B1/B2) must turn them
into passing tests (strict=True makes an unexpected pass fail the suite).
"""

import pytest

from tests.helpers import upload_repo

FIXTURE = {
    # Python: a <-> b import cycle, stdlib and third-party imports.
    "demo/__init__.py": "",
    "demo/app.py": "import os\nimport subprocess\nfrom demo import b\nimport requests\n",
    "demo/b.py": "from demo import app\nfrom fastapi import APIRouter\n",
    # JavaScript: index <-> util cycle, scoped package.
    "web/index.js": "import React from 'react'\nimport { x } from './util'\nimport api from '@scope/pkg'\nexport function main() { return x() }\n",
    "web/util.js": "import { main } from './index'\nexport const x = () => main()\n",
    "requirements.txt": "requests==2.31.0\nfastapi\n",
    "package.json": '{"dependencies": {"react": "^18.0.0", "@scope/pkg": "1.0.0"}}',
}


@pytest.fixture
def repo(client):
    return upload_repo(client, FIXTURE)


@pytest.fixture
def analysis(client, repo):
    response = client.get(f"/api/repositories/{repo['id']}/dependencies")
    assert response.status_code == 200, response.text
    return response.json()


def _externals(analysis):
    return {dep["name"] for dep in analysis["external_dependencies"]}


@pytest.mark.parametrize(
    "suffix", ["", "/circular", "/external", "/module-graph", "/stats"]
)
def test_endpoints_respond(client, repo, suffix):
    response = client.get(f"/api/repositories/{repo['id']}/dependencies{suffix}")

    assert response.status_code == 200, response.text
    assert response.json()["repository_id"] == repo["id"]


def test_response_contract(analysis):
    expected = {
        "repository_id",
        "total_internal_modules",
        "total_external_dependencies",
        "circular_dependencies",
        "module_dependencies",
        "external_dependencies",
        "dependency_graph_data",
        "language_breakdown",
        "stats",
        "generated_at",
    }

    assert expected <= set(analysis)
    assert set(analysis["language_breakdown"]) == {"python", "javascript"}


def test_declared_manifest_packages_are_reported(analysis):
    assert {"requests", "react"} <= _externals(analysis)


@pytest.mark.parametrize(
    "suffix", ["", "/circular", "/external", "/module-graph", "/stats"]
)
def test_unknown_repository_is_404(client, suffix):
    assert client.get(f"/api/repositories/{'0' * 32}/dependencies{suffix}").status_code == 404


@pytest.mark.parametrize("max_nodes", [10, 10_000])
def test_max_nodes_is_validated(client, repo, max_nodes):
    response = client.get(
        f"/api/repositories/{repo['id']}/dependencies", params={"max_nodes": max_nodes}
    )
    assert response.status_code == 422


# --- Accuracy (were strict xfail in Stage 1; fixed by B1) ----------------------


def test_stdlib_is_not_external(analysis):
    assert not {"os", "subprocess"} & _externals(analysis)


def test_imported_symbols_are_not_packages(analysis):
    assert not {"APIRouter", "React", "x", "main", "b", "app"} & _externals(analysis)


def test_scoped_packages_are_kept_from_imports(analysis):
    dep = next(d for d in analysis["external_dependencies"] if d["name"] == "@scope/pkg")
    assert dep["import_count"] >= 1


def test_python_and_js_cycles_are_detected(analysis):
    cycles = [sorted(c["cycle"]) for c in analysis["circular_dependencies"]]
    assert sorted(["demo/app.py", "demo/b.py"]) in cycles
    assert sorted(["web/index.js", "web/util.js"]) in cycles


def test_internal_module_edges_are_reported(analysis):
    edges = {(d["source_module"], d["target_module"]) for d in analysis["module_dependencies"]}
    assert ("web/index.js", "web/util.js") in edges


@pytest.mark.xfail(strict=True, reason="SEC-04: absolute server paths returned (Stage 2)")
def test_only_repository_relative_paths_are_returned(analysis, upload_root):
    assert str(upload_root) not in str(analysis)
    assert str(upload_root).replace("\\", "\\\\") not in str(analysis)
