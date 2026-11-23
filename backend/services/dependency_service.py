"""
Dependency analysis service.

The analysis is computed once per repository and persisted next to the
repository (``<workspace>/dependencies.json``). Imported repositories are
never modified in place, and every import (including re-importing the same
project) creates a new workspace, so the cache needs no other invalidation
than an explicit ``refresh`` or a change of ``CACHE_VERSION``.

Routes call these functions from a worker thread; nothing here is async.
"""

from __future__ import annotations

import json
import logging
import threading
from collections import OrderedDict
from pathlib import Path, PurePosixPath
from typing import Any

from backend.services.repository_service import get_repository
from utils.code_graph import CodeEdge, CodeGraphBuilder, EdgeType, parse_repository
from utils.code_graph.dependencies import MANIFEST_PATTERNS, build_dependency_report
from utils.code_graph.import_graph import build_import_graph
from utils.config import get_upload_dir
from utils.file_handler import get_code_files

logger = logging.getLogger(__name__)

CACHE_FILE = "dependencies.json"
# Bump whenever the report format or the analysis itself changes.
CACHE_VERSION = 1
# The largest max_nodes a client may request; graphs are stored ranked and
# trimmed per request.
GRAPH_EXPORT_LIMIT = 500

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()

# Recently used reports, so repeated requests skip the disk entirely.
_MEMORY_CACHE_SIZE = 8
_memory: OrderedDict[str, dict[str, Any]] = OrderedDict()


def _lock_for(repo_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(repo_id, threading.Lock())


def _cache_path(repo_id: str) -> Path:
    upload_root = get_upload_dir()
    workspace = (upload_root / repo_id).resolve()

    if workspace.parent != upload_root:
        raise ValueError("Invalid repository workspace.")

    return workspace / CACHE_FILE


def _read_cache(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8") as file:
            cached = json.load(file)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        logger.warning("Ignoring unreadable dependency cache %s", path.name)
        return None

    if (
        not isinstance(cached, dict)
        or cached.get("version") != CACHE_VERSION
        or not isinstance(cached.get("report"), dict)
    ):
        return None

    return cached["report"]


def _write_cache(path: Path, report: dict[str, Any]) -> None:
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        json.dump({"version": CACHE_VERSION, "report": report}, file)
    temporary.replace(path)


def _rank_module_graph(report: dict[str, Any]) -> None:
    """Order file nodes by connectivity so trimming keeps the busiest files."""

    module_graph = report["dependency_graph_data"]["moduleGraph"]
    degree: dict[str, int] = {}
    for edge in module_graph["edges"]:
        degree[edge["source"]] = degree.get(edge["source"], 0) + 1
        degree[edge["target"]] = degree.get(edge["target"], 0) + 1
    module_graph["nodes"].sort(key=lambda node: (-degree.get(node["id"], 0), node["id"]))


def compute_dependency_report(repo_id: str, root: Path) -> dict[str, Any]:
    """Run the full analysis for the repository at ``root`` (slow path)."""

    root = Path(root)
    files = [
        Path(path).relative_to(root).as_posix()
        for path in get_code_files(root, include_patterns=MANIFEST_PATTERNS)
    ]

    # Each file is read once and shared by both analyses.
    contents: dict[str, str] = {}

    def read_file(relative: str) -> str:
        if relative not in contents:
            contents[relative] = (root / relative).read_text(encoding="utf-8", errors="replace")
        return contents[relative]

    graph = build_import_graph(root, files, read_text=read_file)

    # Function-level graph (definitions, calls) over the same files, using
    # repository-relative paths so node ids never contain local paths.
    parsed = parse_repository([PurePosixPath(path) for path in graph.files], read_file)
    # File-to-file IMPORTS edges come from the resolved import graph.
    import_edges = [
        CodeEdge(
            source=f"file:{source}",
            target=f"file:{target}",
            edge_type=EdgeType.IMPORTS,
            confidence="certain",
            line=items[0].line,
        )
        for (source, target), items in graph.internal_edges().items()
    ]
    builder = CodeGraphBuilder()
    builder.build(parsed["nodes"], parsed["edges"] + import_edges)

    report = build_dependency_report(
        repo_id,
        root,
        files,
        graph,
        code_graph=builder.export_for_frontend(max_nodes=GRAPH_EXPORT_LIMIT),
        code_stats={
            "total_calls": sum(1 for e in parsed["edges"] if e.edge_type.name == "CALLS"),
            "dead_code_count": len(builder.find_dead_code()),
            "hotspot_count": len(builder.find_hotspots()),
        },
    )
    _rank_module_graph(report)
    return report


def get_dependency_report(repo_id: str, *, refresh: bool = False) -> dict[str, Any]:
    """
    Cached dependency report for a repository.

    Raises ValueError for unknown repositories. Concurrent first requests for
    the same repository wait for a single computation.
    """

    repository = get_repository(repo_id)
    root = Path(repository["path"]).resolve()
    cache = _cache_path(repo_id)

    with _lock_for(repo_id):
        if not refresh:
            cached = _memory.get(repo_id)
            if cached is None:
                cached = _read_cache(cache)
            if cached is not None:
                _remember(repo_id, cached)
                return cached

        report = compute_dependency_report(repo_id, root)
        _write_cache(cache, report)
        _remember(repo_id, report)
        return report


def _remember(repo_id: str, report: dict[str, Any]) -> None:
    with _locks_guard:
        _memory[repo_id] = report
        _memory.move_to_end(repo_id)
        while len(_memory) > _MEMORY_CACHE_SIZE:
            _memory.popitem(last=False)


def forget(repo_id: str) -> None:
    """Drop the in-memory copy (the repository was deleted)."""
    with _locks_guard:
        _memory.pop(repo_id, None)


def _trim(graph: dict[str, Any], max_nodes: int) -> dict[str, Any]:
    nodes = graph.get("nodes", [])[:max_nodes]
    kept = {node["id"] for node in nodes}
    edges = [
        edge for edge in graph.get("edges", [])
        if edge["source"] in kept and edge["target"] in kept
    ]
    return {**graph, "nodes": nodes, "edges": edges}


def view_with_limit(report: dict[str, Any], max_nodes: int) -> dict[str, Any]:
    """Return the report with both graphs limited to ``max_nodes`` nodes."""

    graph_data = report["dependency_graph_data"]
    code_graph = _trim(graph_data, max_nodes)
    module_graph = _trim(graph_data["moduleGraph"], max_nodes)

    return {
        **report,
        "dependency_graph_data": {
            **code_graph,
            "showingNodes": len(code_graph["nodes"]),
            "showingEdges": len(code_graph["edges"]),
            "moduleGraph": module_graph,
        },
    }
