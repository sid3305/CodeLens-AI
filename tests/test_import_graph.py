"""
B1: file-level import graph.

Every fixture under tests/fixtures/dependency_repos is a small real
repository with a known answer.
"""

from pathlib import Path

import pytest

from tests.conftest import FIXTURES
from utils.code_graph.import_graph import build_import_graph
from utils.file_handler import get_code_files

REPOS = FIXTURES / "dependency_repos"


def graph(name):
    root = REPOS / name
    files = [Path(p).relative_to(root).as_posix() for p in get_code_files(root)]
    return build_import_graph(root, files)


def internal_targets(g, source):
    return {
        item.target
        for item in g.imports
        if item.source == source and item.category == "internal" and item.target
    }


def categories(g, source):
    return {item.specifier: item.category for item in g.imports if item.source == source}


def rotated(cycle):
    """Rotate a cycle to start at its smallest member (order preserved)."""
    start = cycle.index(min(cycle))
    return tuple(cycle[start:] + cycle[:start])


# --- Python ----------------------------------------------------------------


def test_python_cycles_are_found_in_order():
    g = graph("py_cycles")

    cycles = {rotated(c) for c in g.cycles()}

    assert cycles == {
        ("pkg/a.py", "pkg/b.py"),
        ("pkg/c.py", "pkg/d.py", "pkg/e.py"),
        ("pkg/selfref.py",),
    }


def test_python_relative_imports_resolve_to_files():
    g = graph("py_relative")

    assert internal_targets(g, "app/core/engine.py") == {
        "app/utils/helpers.py",  # from ..utils import helpers (submodule)
        "app/core/config.py",  # from . import config
        "app/__init__.py",  # from .. import VERSION (attribute of the package)
    }
    assert internal_targets(g, "app/__init__.py") == {"app/core/engine.py"}


def test_unresolvable_relative_imports_are_reported_not_external():
    g = graph("py_relative")

    unresolved = {(u.source, u.specifier) for u in g.unresolved()}

    assert ("app/core/engine.py", ".missing_module") in unresolved
    assert ("app/core/engine.py", "....") in unresolved
    assert g.external_packages() == {}


def test_src_layout_packages_resolve():
    g = graph("py_src_layout")

    assert internal_targets(g, "src/mypkg/core.py") == {"src/mypkg/util.py"}
    assert internal_targets(g, "tests/check_core.py") == {"src/mypkg/core.py"}


def test_stdlib_local_and_third_party_are_told_apart():
    g = graph("py_collisions")

    main = categories(g, "main.py")
    assert main["__future__"] == "stdlib"
    assert main["os"] == "stdlib"
    assert main["json"] == "stdlib"
    assert main["utils"] == "internal"
    assert main["utils.helpers"] == "internal"
    assert main["utils.nothere"] == "unresolved"
    assert main["requests"] == "external"
    assert internal_targets(g, "main.py") == {"utils/__init__.py", "utils/helpers.py"}


def test_local_module_named_like_stdlib_only_shadows_where_python_would():
    g = graph("py_collisions")

    loader = {(i.specifier, i.category, i.target) for i in g.imports if i.source == "pkg/loader.py"}

    assert ("json", "stdlib", None) in loader
    assert (".", "internal", "pkg/json.py") in loader
    assert ("collections.abc", "stdlib", None) in loader


def test_script_directories_resolve_sibling_modules():
    g = graph("py_collisions")

    assert internal_targets(g, "scripts/run.py") == {"scripts/helpers.py"}


def test_python_distributions_are_normalised():
    g = graph("py_collisions")

    assert set(g.external_packages()) == {
        "requests",
        "pyyaml",
        "pillow",
        "opencv-python",
        "beautifulsoup4",
        "scikit-learn",
        "numpy",
    }


def test_multiline_parenthesised_and_aliased_imports():
    g = graph("py_multiline")

    os_path = next(i for i in g.imports if i.specifier == "os.path")
    assert os_path.names == ["join", "exists"]
    assert os_path.category == "stdlib"
    assert internal_targets(g, "m.py") == {"a_mod/b_mod/c_mod.py", "helpers.py"}
    assert categories(g, "m.py")["sys"] == "stdlib"


def test_syntax_errors_are_skipped_and_reported():
    g = graph("py_syntax_error")

    (skipped,) = g.skipped
    assert skipped.path == "broken.py"
    assert "line 1" in skipped.reason
    assert "broken.py" not in g.files
    assert internal_targets(g, "good.py") == {"util.py"}


# --- JavaScript / TypeScript --------------------------------------------------


def test_js_and_ts_cycles_through_index_files_and_dynamic_imports():
    g = graph("js_cycles")

    cycles = {rotated(c) for c in g.cycles()}

    assert cycles == {
        ("src/components/index.js", "src/index.js"),
        ("src/heavy.ts", "src/lazy.ts"),
    }


def test_js_import_forms_resolve():
    g = graph("js_cycles")

    assert internal_targets(g, "src/components/index.js") == {
        "src/components/Button.jsx",  # export ... from
        "src/index.js",  # '../index'
    }
    assert internal_targets(g, "src/components/Button.jsx") == {"src/util.cjs"}  # require()
    assert internal_targets(g, "src/lazy.ts") == {"src/types.ts", "src/heavy.ts"}  # import type, import()
    assert internal_targets(g, "src/heavy.ts") == {"src/lazy.ts"}  # './lazy.js' -> lazy.ts
    assert set(g.external_packages()) == {"react"}


def test_tsconfig_paths_and_base_url():
    g = graph("ts_paths")

    assert internal_targets(g, "src/app.tsx") == {
        "src/components/Button.tsx",
        "src/utils/index.ts",
        "src/config.ts",
    }
    assert [u.specifier for u in g.unresolved()] == ["@/nope"]
    assert set(g.external_packages()) == {"react"}


def test_npm_packages_builtins_and_unresolved_specifiers():
    g = graph("npm_scoped")

    packages = g.external_packages()
    assert set(packages) == {"@scope/pkg", "lodash", "express"}
    assert packages["@scope/pkg"].import_count == 2
    assert packages["lodash"].import_count == 2
    assert packages["@scope/pkg"].files == ["index.js"]

    cats = categories(g, "index.js")
    assert cats["node:fs"] == "stdlib"
    assert cats["path"] == "stdlib"
    assert cats["fs/promises"] == "stdlib"
    assert {u.specifier for u in g.unresolved()} == {
        "./missing",
        "https://cdn.example.com/lib.js",
    }


# --- General -----------------------------------------------------------------


def test_repository_without_source_files():
    g = graph("empty")

    assert g.files == []
    assert g.imports == []
    assert g.cycles() == []


@pytest.mark.parametrize("name", sorted(p.name for p in REPOS.iterdir()))
def test_every_fixture_produces_repo_relative_posix_paths(name):
    g = graph(name)

    paths = [*g.files, *(i.source for i in g.imports), *(i.target for i in g.imports if i.target)]
    assert all("\\" not in p and not Path(p).is_absolute() for p in paths)


# --- Edge cases built on the fly -------------------------------------------------


def _write(root, files):
    for relative, content in files.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    return build_import_graph(root, sorted(files))


def test_javascript_syntax_errors_are_skipped(tmp_path):
    g = _write(tmp_path, {"ok.ts": "import { a } from './b'\n", "b.ts": "export const a = 1\n",
                          "bad.ts": "export const x = {\n  oops\n"})

    assert [s.path for s in g.skipped] == ["bad.ts"]
    assert "line" in g.skipped[0].reason
    assert internal_targets(g, "ok.ts") == {"b.ts"}


def test_jsconfig_is_used_when_there_is_no_tsconfig(tmp_path):
    g = _write(tmp_path, {
        "jsconfig.json": '{"compilerOptions": {"baseUrl": "src"}}',
        "src/main.js": "import cfg from 'lib/config'\n",
        "src/lib/config.js": "export default {}\n",
    })

    assert internal_targets(g, "src/main.js") == {"src/lib/config.js"}


def test_invalid_tsconfig_is_ignored(tmp_path):
    g = _write(tmp_path, {"tsconfig.json": "{ not json", "a.ts": "import x from 'pkg'\n"})

    assert set(g.external_packages()) == {"pkg"}


@pytest.mark.parametrize(
    ("specifier", "reason"),
    [
        ("../../outside", "beyond"),
        ("/etc/thing", "absolute"),
        ("#internal/thing", "imports"),
        ("data:text/javascript,1", "URL"),
    ],
)
def test_unsupported_javascript_specifiers_are_unresolved(tmp_path, specifier, reason):
    g = _write(tmp_path, {"src/a.js": f"import x from '{specifier}'\n"})

    (item,) = g.unresolved()
    assert reason in item.reason
    assert g.external_packages() == {}


def test_python_relative_import_beyond_root_is_unresolved(tmp_path):
    g = _write(tmp_path, {"top.py": "from .. import x\n"})

    (item,) = g.unresolved()
    assert "beyond" in item.reason


def test_json_imports_resolve(tmp_path):
    g = _write(tmp_path, {"a.js": "import data from './data.json'\n", "data.json": "{}"})

    assert internal_targets(g, "a.js") == {"data.json"}
