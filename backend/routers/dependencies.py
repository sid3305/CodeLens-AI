"""
Dependencies analysis router.

Endpoints for analyzing and visualizing code dependencies.
"""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.schemas.dependencies import DependenciesAnalysisResponse
from backend.services.repository_service import get_repository
from utils.code_graph import CodeGraphBuilder, parse_repository
from utils.code_graph.dependencies import MANIFEST_PATTERNS, build_dependency_report
from utils.code_graph.import_graph import build_import_graph
from utils.file_handler import get_code_files

router = APIRouter(
    prefix="/api/repositories",
    tags=["Dependencies Analysis"],
)


def _analyze(repo_id: str, max_nodes: int = 200) -> dict[str, Any]:
    try:
        repository = get_repository(repo_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))

    root = Path(repository["path"]).resolve()
    files = [
        Path(path).relative_to(root).as_posix()
        for path in get_code_files(root, include_patterns=MANIFEST_PATTERNS)
    ]

    graph = build_import_graph(root, files)

    def read_file(file_path: str) -> str:
        try:
            return Path(file_path).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return ""

    parsed = parse_repository([root / path for path in graph.files], read_file)
    builder = CodeGraphBuilder()
    builder.build(parsed["nodes"], parsed["edges"])

    return build_dependency_report(
        repo_id,
        root,
        files,
        graph,
        code_graph=builder.export_for_frontend(max_nodes=max_nodes),
        code_stats={
            "total_calls": sum(1 for e in parsed["edges"] if e.edge_type.name == "CALLS"),
            "dead_code_count": len(builder.find_dead_code()),
            "hotspot_count": len(builder.find_hotspots()),
        },
    )


@router.get("/{repo_id}/dependencies", response_model=DependenciesAnalysisResponse)
def get_dependencies_analysis(
    repo_id: str,
    max_nodes: int = Query(200, ge=50, le=500, description="Max nodes in graph visualization"),
):
    """Full dependency analysis: cycles, internal, external and unresolved imports."""

    return _analyze(repo_id, max_nodes)


@router.get("/{repo_id}/dependencies/circular")
def get_circular_dependencies(repo_id: str):
    """Only circular import dependencies."""

    report = _analyze(repo_id)
    return {
        "repository_id": repo_id,
        "circular_dependencies": report["circular_dependencies"],
        "count": len(report["circular_dependencies"]),
    }


@router.get("/{repo_id}/dependencies/external")
def get_external_dependencies(repo_id: str):
    """External (third-party) dependencies with details."""

    report = _analyze(repo_id)
    return {
        "repository_id": repo_id,
        "external_dependencies": report["external_dependencies"],
        "count": len(report["external_dependencies"]),
    }


@router.get("/{repo_id}/dependencies/module-graph")
def get_module_dependency_graph(repo_id: str):
    """File-level dependency graph for visualization."""

    report = _analyze(repo_id)
    return {
        "repository_id": repo_id,
        "module_graph": report["dependency_graph_data"]["moduleGraph"],
        "module_count": report["total_internal_modules"],
        "dependency_count": len(report["module_dependencies"]),
    }


@router.get("/{repo_id}/dependencies/stats")
def get_dependencies_stats(repo_id: str):
    """Quick dependency statistics."""

    return {"repository_id": repo_id, "stats": _analyze(repo_id)["stats"]}
