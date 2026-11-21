
"""
Dependencies analysis schemas for API responses.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ExternalDependency(BaseModel):
    name: str
    source_files: List[str] = Field(default_factory=list)
    import_count: int = 0
    language: str = ""
    version: Optional[str] = None
    is_dev_dependency: bool = False


class ModuleDependency(BaseModel):
    source_module: str
    target_module: str
    import_type: str
    imports: List[str] = Field(default_factory=list)
    edge_count: int = 1


class CircularDependency(BaseModel):
    cycle: List[str] = Field(default_factory=list)
    cycle_type: str
    severity: str
    description: str = ""


class LanguageBreakdown(BaseModel):
    files: int = 0
    internal_deps: int = 0
    external_deps: int = 0


class DependenciesGraphData(BaseModel):
    nodes: List[Dict[str, Any]] = Field(default_factory=list)
    edges: List[Dict[str, Any]] = Field(default_factory=list)
    totalNodes: int = 0
    totalEdges: int = 0
    showingNodes: int = 0
    showingEdges: int = 0
    folders: List[str] = Field(default_factory=list)
    moduleGraph: Optional[Dict[str, Any]] = None


class DependenciesStats(BaseModel):
    total_imports: int = 0
    total_calls: int = 0
    circular_import_count: int = 0
    dead_code_count: int = 0
    hotspot_count: int = 0
    file_count: int = 0


class DependenciesAnalysisResponse(BaseModel):
    repository_id: str
    total_internal_modules: int
    total_external_dependencies: int
    circular_dependencies: List[CircularDependency] = Field(default_factory=list)
    module_dependencies: List[ModuleDependency] = Field(default_factory=list)
    external_dependencies: List[ExternalDependency] = Field(default_factory=list)
    dependency_graph_data: DependenciesGraphData
    language_breakdown: Dict[str, LanguageBreakdown] = Field(default_factory=dict)
    stats: DependenciesStats
    generated_at: datetime


class ExternalDependencyDetail(BaseModel):
    name: str
    version: Optional[str] = None
    language: str
    import_count: int
    source_files: List[str] = Field(default_factory=list)
    is_dev_dependency: bool
    is_outdated: Optional[bool] = None
    latest_version: Optional[str] = None
    vulnerability_count: int = 0
