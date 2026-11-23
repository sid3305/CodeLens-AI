"""
Dependency analysis endpoints.

The smoke tests pin the response contract. The accuracy and path tests
were strict xfail in Stage 1 and were turned into passing tests by B1/B2.
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


def test_only_repository_relative_paths_are_returned(analysis, upload_root):
    assert str(upload_root) not in str(analysis)
    assert str(upload_root).replace("\\", "\\\\") not in str(analysis)


# --- Per-file standard-library imports (X2) ------------------------------------


def test_stdlib_imports_are_listed_per_file(analysis):
    stdlib = {item["name"]: item for item in analysis["stdlib_imports"]}

    assert {"os", "subprocess"} <= set(stdlib)
    assert stdlib["os"]["source_files"] == ["demo/app.py"]
    assert stdlib["os"]["language"] == "python"
    assert stdlib["os"]["import_count"] == 1
    # Never mixed with third-party packages.
    assert not set(stdlib) & _externals(analysis)


def test_stdlib_count_matches_the_statistics(analysis):
    statements = sum(item["import_count"] for item in analysis["stdlib_imports"])
    assert statements == analysis["stats"]["stdlib_imports"]


def test_node_builtins_are_stdlib(client):
    repo = upload_repo(client, {"web/a.js": "import fs from 'node:fs'\nconst path = require('path')\n"})
    analysis = client.get(f"/api/repositories/{repo['id']}/dependencies").json()

    names = {item["name"] for item in analysis["stdlib_imports"]}
    assert {"fs", "path"} <= names
    assert all(item["source_files"] == ["web/a.js"] for item in analysis["stdlib_imports"])


def test_analyzed_files_lists_every_source_file(analysis):
    assert analysis["analyzed_files"] == [
        "demo/__init__.py", "demo/app.py", "demo/b.py", "web/index.js", "web/util.js",
    ]
    # Manifests are read for declarations, not analysed for imports.
    assert "requirements.txt" not in analysis["analyzed_files"]


def test_analyzed_files_is_not_trimmed_with_the_graph(client):
    files = {f"pkg/m{i:03}.py": "import os\n" for i in range(60)}
    repo = upload_repo(client, files)
    analysis = client.get(f"/api/repositories/{repo['id']}/dependencies?max_nodes=50").json()

    assert len(analysis["dependency_graph_data"]["moduleGraph"]["nodes"]) == 50
    assert analysis["analyzed_files"] == sorted(files)
