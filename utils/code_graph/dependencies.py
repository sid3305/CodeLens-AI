"""
Dependency report built from the file-level import graph.

Combines the import graph (utils/code_graph/import_graph.py) with package
manifests (requirements*.txt, package.json, pyproject.toml) into the
response served by the dependencies API. All paths are repository-relative.
"""

from __future__ import annotations

import json
import posixpath
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from utils.code_graph.import_graph import ImportGraph, normalise_distribution

try:  # Python 3.11+
    import tomllib
except ImportError:  # pragma: no cover - Python 3.10
    tomllib = None

# Extra (non-source) files the dependency analysis needs from the walk.
MANIFEST_PATTERNS = ("requirements*.txt",)

_REQUIREMENT = re.compile(
    r"^\s*(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)"  # distribution name
    r"(?:\[[^\]]*\])?"  # optional extras
    r"\s*(?P<version>(?:[=<>!~]=?|===)[^;#]*)?"  # optional version specifier
)


# --- Manifests ---------------------------------------------------------------


def parse_requirements_txt(content: str) -> list[dict[str, str | None]]:
    """Requirement lines -> [{name, version}]. Options and comments are ignored."""

    deps = []
    for raw in content.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        match = _REQUIREMENT.match(line)
        if match:
            version = (match.group("version") or "").strip() or None
            deps.append({"name": match.group("name"), "version": version})
    return deps


def parse_package_json(content: str) -> dict[str, dict[str, str]]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        key: value
        for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")
        if isinstance(value := data.get(key), dict)
    }


def parse_pyproject_toml(content: str) -> dict[str, dict[str, str | None]]:
    """
    PEP 621 ([project] dependencies / optional-dependencies) and Poetry.

    Returns {"dependencies": {...}, "dev_dependencies": {...}}. On Python 3.10
    (no tomllib) pyproject.toml is not read.
    """

    result: dict[str, dict[str, str | None]] = {"dependencies": {}, "dev_dependencies": {}}
    if tomllib is None:  # pragma: no cover - Python 3.10
        return result

    try:
        data = tomllib.loads(content)
    except tomllib.TOMLDecodeError:
        return result

    project = data.get("project") or {}

    def add(target: str, requirement: str) -> None:
        parsed = parse_requirements_txt(requirement)
        if parsed:
            result[target][parsed[0]["name"]] = parsed[0]["version"]

    for requirement in project.get("dependencies") or []:
        if isinstance(requirement, str):
            add("dependencies", requirement)
    for group in (project.get("optional-dependencies") or {}).values():
        for requirement in group if isinstance(group, list) else []:
            if isinstance(requirement, str):
                add("dev_dependencies", requirement)

    poetry = (data.get("tool") or {}).get("poetry") or {}
    for name, spec in (poetry.get("dependencies") or {}).items():
        if name.lower() != "python":
            result["dependencies"][name] = spec if isinstance(spec, str) else None
    for name, spec in (poetry.get("dev-dependencies") or {}).items():
        result["dev_dependencies"][name] = spec if isinstance(spec, str) else None

    return result


def _manifest_entries(root: Path, files: list[str]):
    """Yield (manifest path, ecosystem, name, version, is_dev) for every declared package."""

    for path in sorted(files):
        name = posixpath.basename(path).lower()
        is_requirements = name.startswith("requirements") and name.endswith(".txt")
        if not (is_requirements or name in ("package.json", "pyproject.toml")):
            continue

        try:
            content = (root / path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        if is_requirements:
            is_dev = "dev" in name or "test" in name
            for dep in parse_requirements_txt(content):
                yield path, "python", dep["name"], dep["version"], is_dev
        elif name == "package.json":
            for section, deps in parse_package_json(content).items():
                is_dev = section in ("devDependencies", "peerDependencies")
                for package, version in deps.items():
                    yield path, "javascript", package, str(version), is_dev
        else:
            for section, deps in parse_pyproject_toml(content).items():
                for package, version in deps.items():
                    yield path, "python", package, version, section == "dev_dependencies"


def external_dependencies(graph: ImportGraph, root: Path, files: list[str]) -> list[dict[str, Any]]:
    """
    One entry per package, merging imports with manifest declarations.

    Python names are PEP 503-normalised distribution names so that
    `import yaml` and `PyYAML` in requirements.txt are the same package.
    """

    merged: dict[str, dict[str, Any]] = {}

    def entry(name: str, language: str) -> dict[str, Any]:
        return merged.setdefault(
            name,
            {
                "name": name,
                "source_files": [],
                "import_count": 0,
                "language": language,
                "version": None,
                "is_dev_dependency": False,
                "declared": False,
            },
        )

    for package in graph.external_packages().values():
        item = entry(package.name, package.language)
        item["import_count"] += package.import_count
        item["source_files"].extend(package.files)

    declared_prod: set[str] = set()
    for manifest, ecosystem, name, version, is_dev in _manifest_entries(root, files):
        key = normalise_distribution(name) if ecosystem == "python" else name
        item = entry(key, ecosystem)
        if not is_dev:
            declared_prod.add(key)
        item["declared"] = True
        item["version"] = item["version"] or version
        item["is_dev_dependency"] = key not in declared_prod
        if manifest not in item["source_files"]:
            item["source_files"].append(manifest)

    return sorted(merged.values(), key=lambda item: (-item["import_count"], item["name"]))


def stdlib_imports(graph: ImportGraph) -> list[dict[str, Any]]:
    """
    Standard-library (and Node.js built-in) modules with the files that
    import them. ``import_count`` counts statements, like the statistics.
    """

    merged: dict[tuple[str, str], dict[str, Any]] = {}
    statements: dict[tuple[str, str], set[tuple[str, int, str]]] = defaultdict(set)

    for item in graph.imports:
        if item.category != "stdlib":
            continue
        name = item.package or item.specifier
        key = (name, item.language)
        entry = merged.setdefault(key, {"name": name, "language": item.language, "source_files": set()})
        entry["source_files"].add(item.source)
        statements[key].add((item.source, item.line, item.specifier))

    result = [
        {**entry, "source_files": sorted(entry["source_files"]), "import_count": len(statements[key])}
        for key, entry in merged.items()
    ]
    return sorted(result, key=lambda item: (-item["import_count"], item["name"], item["language"]))


# --- Report ------------------------------------------------------------------


def _cycle_severity(length: int) -> str:
    if length <= 3:
        return "high"
    if length <= 5:
        return "medium"
    return "low"


def circular_dependencies(graph: ImportGraph) -> list[dict[str, Any]]:
    cycles = []
    for order, members in graph.cyclic_groups():
        path = " -> ".join([*order, order[0]])
        cycles.append({
            "cycle": order,
            "files": members,
            "cycle_type": "import",
            "severity": _cycle_severity(len(members)),
            "description": f"Circular import chain: {path}",
        })
    return cycles


def module_dependencies(graph: ImportGraph) -> list[dict[str, Any]]:
    modules = []
    for (source, target), items in sorted(graph.internal_edges().items()):
        names: list[str] = []
        for item in items:
            for name in item.names or [item.specifier]:
                if name not in names:
                    names.append(name)
        modules.append({
            "source_module": source,
            "target_module": target,
            "import_type": "internal",
            "imports": names,
            "edge_count": len(items),
        })
    return modules


def module_graph(graph: ImportGraph, modules: list[dict[str, Any]]) -> dict[str, Any]:
    """File-level graph in React Flow format."""

    nodes = [
        {
            "id": f"file:{path}",
            "type": "moduleNode",
            "data": {
                "label": posixpath.basename(path),
                "fullLabel": path,
                "filePath": path,
                "language": graph.languages[path],
            },
            "position": {"x": 0, "y": 0},
        }
        for path in graph.files
    ]
    edges = [
        {
            "id": f"file:{dep['source_module']}->file:{dep['target_module']}",
            "source": f"file:{dep['source_module']}",
            "target": f"file:{dep['target_module']}",
            "type": "moduleEdge",
            # Import names are in module_dependencies; not repeated here.
            "data": {"edgeCount": dep["edge_count"]},
        }
        for dep in modules
    ]
    return {"nodes": nodes, "edges": edges}


def language_breakdown(graph: ImportGraph) -> dict[str, dict[str, int]]:
    breakdown: dict[str, dict[str, int]] = defaultdict(
        lambda: {"files": 0, "internal_deps": 0, "external_deps": 0}
    )
    for language in graph.languages.values():
        breakdown[language]["files"] += 1

    for source, _target in graph.internal_edges():
        breakdown[graph.languages[source]]["internal_deps"] += 1

    packages_by_language: dict[str, set[str]] = defaultdict(set)
    for item in graph.imports:
        if item.category == "external" and item.package:
            packages_by_language[item.language].add(item.package)
    for language, packages in packages_by_language.items():
        breakdown[language]["external_deps"] = len(packages)

    return dict(sorted(breakdown.items()))


def import_statistics(graph: ImportGraph) -> dict[str, int]:
    statements = {(item.source, item.line, item.specifier) for item in graph.imports}
    by_category: dict[str, set] = defaultdict(set)
    for item in graph.imports:
        by_category[item.category].add((item.source, item.line, item.specifier))
    return {
        "total_imports": len(statements),
        "internal_imports": len(by_category["internal"]),
        "stdlib_imports": len(by_category["stdlib"]),
        "external_imports": len(by_category["external"]),
        "unresolved_imports": len(by_category["unresolved"]),
    }


def build_dependency_report(
    repo_id: str,
    root: Path,
    files: list[str],
    graph: ImportGraph,
    *,
    code_graph: dict[str, Any] | None = None,
    code_stats: dict[str, int] | None = None,
) -> dict[str, Any]:
    """
    Assemble the full dependency report.

    ``code_graph``/``code_stats`` come from the function-level code graph
    (calls, dead code, hotspots) and are optional.
    """

    modules = module_dependencies(graph)
    cycles = circular_dependencies(graph)
    externals = external_dependencies(graph, root, files)

    graph_data = dict(code_graph or {"nodes": [], "edges": [], "totalNodes": 0, "totalEdges": 0,
                                     "showingNodes": 0, "showingEdges": 0})
    graph_data.setdefault("folders", sorted({posixpath.dirname(p) or "." for p in graph.files}))
    graph_data["moduleGraph"] = module_graph(graph, modules)

    stats = {
        **import_statistics(graph),
        "total_calls": 0,
        "dead_code_count": 0,
        "hotspot_count": 0,
        **(code_stats or {}),
        "circular_import_count": len(cycles),
        "file_count": len(graph.files),
    }

    return {
        "repository_id": repo_id,
        "total_internal_modules": len(graph.files),
        "total_external_dependencies": len(externals),
        "circular_dependencies": cycles,
        "module_dependencies": modules,
        "external_dependencies": externals,
        "stdlib_imports": stdlib_imports(graph),
        "analyzed_files": sorted(graph.files),
        "unresolved_imports": [
            {
                "file": item.source,
                "line": item.line,
                "specifier": item.specifier,
                "language": item.language,
                "reason": item.reason or "unresolved",
            }
            for item in graph.unresolved()
        ],
        "skipped_files": [{"path": s.path, "reason": s.reason} for s in graph.skipped],
        "dependency_graph_data": graph_data,
        "language_breakdown": language_breakdown(graph),
        "stats": stats,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
