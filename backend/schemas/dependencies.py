
"""
Dependencies analysis schemas for API responses.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ExternalDependency(BaseModel):
    name: str
    source_files: list[str] = Field(default_factory=list)
    import_count: int = 0
    language: str = ""
    version: str | None = None
    is_dev_dependency: bool = False
    declared: bool = False


class ModuleDependency(BaseModel):
    source_module: str
    target_module: str
    import_type: str
    imports: list[str] = Field(default_factory=list)
    edge_count: int = 1


class CircularDependency(BaseModel):
    cycle: list[str] = Field(default_factory=list)
    files: list[str] = Field(default_factory=list)
    cycle_type: str
    severity: str
    description: str = ""


class LanguageBreakdown(BaseModel):
    files: int = 0
    internal_deps: int = 0
    external_deps: int = 0


class DependenciesGraphData(BaseModel):
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    totalNodes: int = 0
    totalEdges: int = 0
    showingNodes: int = 0
    showingEdges: int = 0
    folders: list[str] = Field(default_factory=list)
    moduleGraph: dict[str, Any] | None = None


class UnresolvedImport(BaseModel):
    file: str
    line: int
    specifier: str
    language: str
    reason: str


class SkippedFile(BaseModel):
    path: str
    reason: str


class DependenciesStats(BaseModel):
    total_imports: int = 0
    internal_imports: int = 0
    stdlib_imports: int = 0
    external_imports: int = 0
    unresolved_imports: int = 0
    total_calls: int = 0
    circular_import_count: int = 0
    dead_code_count: int = 0
    hotspot_count: int = 0
    file_count: int = 0


class DependenciesAnalysisResponse(BaseModel):
    repository_id: str
    total_internal_modules: int
    total_external_dependencies: int
    circular_dependencies: list[CircularDependency] = Field(default_factory=list)
    module_dependencies: list[ModuleDependency] = Field(default_factory=list)
    external_dependencies: list[ExternalDependency] = Field(default_factory=list)
    unresolved_imports: list[UnresolvedImport] = Field(default_factory=list)
    skipped_files: list[SkippedFile] = Field(default_factory=list)
    dependency_graph_data: DependenciesGraphData
    language_breakdown: dict[str, LanguageBreakdown] = Field(default_factory=dict)
    stats: DependenciesStats
    generated_at: datetime
