"""
Dependencies analysis routes.

Thin wrappers around backend.services.dependency_service. The analysis is
computed in a worker thread so it never blocks the event loop; results are
cached per repository.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from backend.schemas.dependencies import DependenciesAnalysisResponse
from backend.services import dependency_service

router = APIRouter(
    prefix="/api/repositories",
    tags=["Dependencies Analysis"],
)


async def _report(repo_id: str, *, refresh: bool = False) -> dict[str, Any]:
    try:
        return await run_in_threadpool(
            dependency_service.get_dependency_report, repo_id, refresh=refresh
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.get("/{repo_id}/dependencies", response_model=DependenciesAnalysisResponse)
async def get_dependencies_analysis(
    repo_id: str,
    max_nodes: int = Query(200, ge=50, le=500, description="Max nodes in each graph"),
    refresh: bool = Query(False, description="Recompute instead of using the cached result"),
):
    """Full dependency analysis: cycles, internal, external and unresolved imports."""

    report = await _report(repo_id, refresh=refresh)
    return dependency_service.view_with_limit(report, max_nodes)


@router.get("/{repo_id}/dependencies/circular")
async def get_circular_dependencies(repo_id: str):
    """Only circular import dependencies."""

    cycles = (await _report(repo_id))["circular_dependencies"]
    return {"repository_id": repo_id, "circular_dependencies": cycles, "count": len(cycles)}


@router.get("/{repo_id}/dependencies/external")
async def get_external_dependencies(repo_id: str):
    """External (third-party) dependencies with details."""

    packages = (await _report(repo_id))["external_dependencies"]
    return {"repository_id": repo_id, "external_dependencies": packages, "count": len(packages)}


@router.get("/{repo_id}/dependencies/module-graph")
async def get_module_dependency_graph(repo_id: str):
    """File-level dependency graph for visualization."""

    report = await _report(repo_id)
    return {
        "repository_id": repo_id,
        "module_graph": report["dependency_graph_data"]["moduleGraph"],
        "module_count": report["total_internal_modules"],
        "dependency_count": len(report["module_dependencies"]),
    }


@router.get("/{repo_id}/dependencies/stats")
async def get_dependencies_stats(repo_id: str):
    """Quick dependency statistics."""

    return {"repository_id": repo_id, "stats": (await _report(repo_id))["stats"]}
