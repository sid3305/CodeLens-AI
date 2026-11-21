"""
Dependencies analysis router.

Endpoints for analyzing and visualizing code dependencies.
"""

from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
from dataclasses import asdict

from backend.services.repository_service import get_repository
from utils.code_graph import parse_repository
from utils.code_graph.dependencies import (
    analyze_dependencies,
    get_dependency_stats,
)
from backend.schemas.dependencies import (
    DependenciesAnalysisResponse,
)
from datetime import datetime, timezone


router = APIRouter(
    prefix="/api/repositories",
    tags=["Dependencies Analysis"],
)


@router.get("/{repo_id}/dependencies", response_model=DependenciesAnalysisResponse)
def get_dependencies_analysis(
    repo_id: str,
    max_nodes: int = Query(200, ge=50, le=500, description="Max nodes in graph visualization"),
):
    """
    Get comprehensive dependencies analysis for a repository.

    Includes:
    - Circular import detection
    - Internal module dependencies
    - External third-party dependencies
    - Module dependency graph for visualization
    - Language breakdown
    """
    try:
        repository = get_repository(repo_id)
        repo_path = Path(repository["path"])

        # Parse repository
        code_files = _get_all_code_files(repo_path)

        def read_file(file_path: str) -> str:
            try:
                return Path(file_path).read_text(encoding="utf-8", errors="ignore")
            except Exception:
                return ""

        result = parse_repository(code_files, read_file)
        nodes = result["nodes"]
        edges = result["edges"]

        # Analyze dependencies
        analysis = analyze_dependencies(repo_id, repo_path, nodes, edges)

        # Get stats
        stats = get_dependency_stats(nodes, edges)

        return DependenciesAnalysisResponse(
    repository_id=analysis.repository_id,
    total_internal_modules=analysis.total_internal_modules,
    total_external_dependencies=analysis.total_external_dependencies,

    circular_dependencies=[
        asdict(dep) for dep in analysis.circular_dependencies
    ],

    module_dependencies=[
        asdict(dep) for dep in analysis.module_dependencies
    ],

    external_dependencies=[
        asdict(dep) for dep in analysis.external_dependencies
    ],

    dependency_graph_data=analysis.dependency_graph_data,
    language_breakdown=analysis.language_breakdown,
    stats=stats,
    generated_at=analysis.generated_at,
)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Dependencies analysis failed: {str(e)}")


@router.get("/{repo_id}/dependencies/circular")
def get_circular_dependencies(repo_id: str):
    """Get only circular import dependencies."""
    try:
        repository = get_repository(repo_id)
        repo_path = Path(repository["path"])

        code_files = _get_all_code_files(repo_path)

        def read_file(file_path: str) -> str:
            try:
                return Path(file_path).read_text(encoding="utf-8", errors="ignore")
            except Exception:
                return ""

        result = parse_repository(code_files, read_file)
        nodes = result["nodes"]
        edges = result["edges"]

        from utils.code_graph.dependencies import find_circular_dependencies
        circular = find_circular_dependencies(nodes, edges)

        return {
            "repository_id": repo_id,
            "circular_dependencies": [asdict(dep) for dep in circular],
            "count": len(circular),
        }

    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find circular dependencies: {str(e)}")


@router.get("/{repo_id}/dependencies/external")
def get_external_dependencies(repo_id: str):
    """Get external (third-party) dependencies with details."""
    try:
        repository = get_repository(repo_id)
        repo_path = Path(repository["path"])

        code_files = _get_all_code_files(repo_path)

        def read_file(file_path: str) -> str:
            try:
                return Path(file_path).read_text(encoding="utf-8", errors="ignore")
            except Exception:
                return ""

        result = parse_repository(code_files, read_file)
        nodes = result["nodes"]
        edges = result["edges"]

        from utils.code_graph.dependencies import extract_external_deps_from_imports
        external_deps = extract_external_deps_from_imports(nodes, edges, repo_path)

        return {
            "repository_id": repo_id,
            "external_dependencies": [asdict(dep) for dep in external_deps],
            "count": len(external_deps),
        }

    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get external dependencies: {str(e)}")


@router.get("/{repo_id}/dependencies/module-graph")
def get_module_dependency_graph(repo_id: str):
    """Get module-level dependency graph for visualization."""
    try:
        repository = get_repository(repo_id)
        repo_path = Path(repository["path"])

        code_files = _get_all_code_files(repo_path)

        def read_file(file_path: str) -> str:
            try:
                return Path(file_path).read_text(encoding="utf-8", errors="ignore")
            except Exception:
                return ""

        result = parse_repository(code_files, read_file)
        nodes = result["nodes"]
        edges = result["edges"]

        from utils.code_graph.dependencies import build_module_dependency_graph
        module_deps, file_deps = build_module_dependency_graph(nodes, edges, repo_path)

        from utils.code_graph.dependencies import _build_module_graph_for_frontend
        module_graph = _build_module_graph_for_frontend(nodes, file_deps, module_deps)

        return {
            "repository_id": repo_id,
            "module_graph": module_graph,
            "module_count": len([n for n in nodes if n.node_type.name == "FILE"]),
            "dependency_count": len(module_deps),
        }

    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get module graph: {str(e)}")


@router.get("/{repo_id}/dependencies/stats")
def get_dependencies_stats(repo_id: str):
    """Get quick dependency statistics."""
    try:
        repository = get_repository(repo_id)
        repo_path = Path(repository["path"])

        code_files = _get_all_code_files(repo_path)

        def read_file(file_path: str) -> str:
            try:
                return Path(file_path).read_text(encoding="utf-8", errors="ignore")
            except Exception:
                return ""

        result = parse_repository(code_files, read_file)
        nodes = result["nodes"]
        edges = result["edges"]

        stats = get_dependency_stats(nodes, edges)

        return {
            "repository_id": repo_id,
            "stats": stats,
        }

    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get dependency stats: {str(e)}")


def _get_all_code_files(repo_path: Path) -> list[Path]:
    """Get all supported code files in repository."""
    supported_extensions = set()
    for parser in set(__import__('utils.code_graph.base', fromlist=['ParserRegistry']).ParserRegistry._parsers.values()):
        if hasattr(parser, 'file_extensions'):
            supported_extensions.update(parser.file_extensions)

    code_files = []
    for ext in supported_extensions:
        code_files.extend(repo_path.rglob(f"*{ext}"))

    # Filter out common non-source directories
    exclude_dirs = {'.git', '__pycache__', 'node_modules', '.venv', 'venv', 'env', 'dist', 'build', '.next', 'out'}
    filtered = []
    for f in code_files:
        if not any(excl in f.parts for excl in exclude_dirs):
            filtered.append(f)

    return filtered