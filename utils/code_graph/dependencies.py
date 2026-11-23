"""
Dependencies Analyzer Module

Extracts and analyzes dependencies within a codebase:
- Circular import detection
- Internal vs external dependencies
- Package/requirements.txt parsing
- Module dependency graphs
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from utils.code_graph.graph_builder import CodeGraphBuilder
from utils.code_graph.models import CodeEdge, CodeNode, EdgeType, NodeType


@dataclass
class ExternalDependency:
    """Represents an external (third-party) dependency."""
    name: str
    source_files: list[str] = field(default_factory=list)
    import_count: int = 0
    language: str = ""
    version: str | None = None
    is_dev_dependency: bool = False


@dataclass
class ModuleDependency:
    """Represents a dependency between modules/files."""
    source_module: str
    target_module: str
    import_type: str  # 'internal', 'external', 'relative'
    imports: list[str] = field(default_factory=list)
    edge_count: int = 1


@dataclass
class CircularDependency:
    """Represents a circular dependency chain."""
    cycle: list[str]
    cycle_type: str  # 'import', 'module'
    severity: str  # 'critical', 'high', 'medium', 'low'
    description: str = ""


@dataclass
class DependenciesAnalysisResult:
    """Complete dependencies analysis result."""
    repository_id: str
    total_internal_modules: int
    total_external_dependencies: int
    circular_dependencies: list[CircularDependency]
    module_dependencies: list[ModuleDependency]
    external_dependencies: list[ExternalDependency]
    dependency_graph_data: dict[str, Any]  # For frontend visualization
    language_breakdown: dict[str, dict[str, int]]
    generated_at: str


def parse_requirements_txt(content: str) -> list[dict[str, str]]:
    """Parse requirements.txt and return list of dependencies with versions."""
    deps = []
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "-")):
            continue
        # Handle various formats: package==1.0.0, package>=1.0.0, package
        match = re.match(r'^([A-Za-z0-9_.-]+)([=<>!~]+.*)?$', line)
        if match:
            name = match.group(1)
            version = match.group(2) if match.group(2) else None
            deps.append({"name": name, "version": version})
    return deps


def parse_package_json(content: str) -> dict[str, Any]:
    """Parse package.json and return dependencies."""
    try:
        data = json.loads(content)
        return {
            "dependencies": data.get("dependencies", {}),
            "devDependencies": data.get("devDependencies", {}),
            "peerDependencies": data.get("peerDependencies", {}),
            "optionalDependencies": data.get("optionalDependencies", {}),
        }
    except json.JSONDecodeError:
        return {}


def parse_pyproject_toml(content: str) -> dict[str, Any]:
    """Parse pyproject.toml for dependencies (basic regex parsing)."""
    # This is a simplified parser - for full TOML support, use tomli/tomllib
    deps = {"dependencies": {}, "dev_dependencies": {}}

    # Find [project] dependencies
    in_deps = False
    in_optional = False

    for line in content.splitlines():
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            in_deps = line == "[project.dependencies]"
            in_optional = line.startswith("[project.optional-dependencies]")
            continue

        if in_deps and "=" in line and not line.startswith("#"):
            parts = line.split("=", 1)
            name = parts[0].strip().strip('"')
            version = parts[1].strip().strip('"')
            deps["dependencies"][name] = version
        elif in_optional and "=" in line and not line.startswith("#"):
            # Optional deps - treat as dev for now
            parts = line.split("=", 1)
            name = parts[0].strip().strip('"')
            version = parts[1].strip().strip('"')
            deps["dev_dependencies"][name] = version

    return deps


def extract_external_deps_from_imports(
    nodes: list[CodeNode],
    edges: list[CodeEdge],
    repo_path: Path
) -> list[ExternalDependency]:
    """Extract external dependencies from import nodes and manifest files."""
    external_deps: dict[str, ExternalDependency] = {}

    # From import nodes
    for node in nodes:
        # Heuristic: external if not relative import
        if node.node_type == NodeType.IMPORT and not node.name.startswith((".", "@")):
            base_name = node.name.split("/")[0].split(".")[0]
            if base_name not in external_deps:
                external_deps[base_name] = ExternalDependency(
                    name=base_name,
                    language=node.language,
                )
            dep = external_deps[base_name]
            dep.import_count += 1
            if node.file_path not in dep.source_files:
                dep.source_files.append(node.file_path)

    # From manifest files
    manifest_files = {
        "requirements.txt": ("python", False),
        "requirements-dev.txt": ("python", True),
        "package.json": ("javascript", False),
        "pyproject.toml": ("python", False),
    }

    for manifest_name, (language, is_dev) in manifest_files.items():
        manifest_path = repo_path / manifest_name
        if manifest_path.exists():
            content = manifest_path.read_text(encoding="utf-8", errors="ignore")

            if manifest_name.endswith(".txt"):
                parsed = parse_requirements_txt(content)
                for dep in parsed:
                    name = dep["name"]
                    if name not in external_deps:
                        external_deps[name] = ExternalDependency(name=name, language=language)
                    dep_obj = external_deps[name]
                    dep_obj.version = dep.get("version")
                    dep_obj.is_dev_dependency = is_dev
                    if str(manifest_path) not in dep_obj.source_files:
                        dep_obj.source_files.append(str(manifest_path))

            elif manifest_name == "package.json":
                parsed = parse_package_json(content)
                for dep_type, deps in parsed.items():
                    is_dev_type = dep_type in ("devDependencies", "peerDependencies")
                    for name, version in deps.items():
                        if name not in external_deps:
                            external_deps[name] = ExternalDependency(name=name, language=language)
                        dep_obj = external_deps[name]
                        dep_obj.version = version
                        dep_obj.is_dev_dependency = is_dev_type
                        if str(manifest_path) not in dep_obj.source_files:
                            dep_obj.source_files.append(str(manifest_path))

            elif manifest_name == "pyproject.toml":
                parsed = parse_pyproject_toml(content)
                for dep_type, deps in parsed.items():
                    is_dev_type = dep_type == "dev_dependencies"
                    for name, version in deps.items():
                        if name not in external_deps:
                            external_deps[name] = ExternalDependency(name=name, language=language)
                        dep_obj = external_deps[name]
                        dep_obj.version = version
                        dep_obj.is_dev_dependency = is_dev_type
                        if str(manifest_path) not in dep_obj.source_files:
                            dep_obj.source_files.append(str(manifest_path))

    return list(external_deps.values())


def build_module_dependency_graph(
    nodes: list[CodeNode],
    edges: list[CodeEdge],
    repo_path: Path
) -> tuple[list[ModuleDependency], dict[str, set[str]]]:
    """Build module-level dependency graph from file-level imports."""
    builder = CodeGraphBuilder()
    builder.build(nodes, edges)

    # Get file-level dependencies
    file_deps = builder.get_module_dependencies()

    module_deps = []
    for src_file, tgt_files in file_deps.items():
        src_module = src_file.replace("file:", "")
        for tgt_file in tgt_files:
            tgt_module = tgt_file.replace("file:", "")

            # Find import edges between these files
            imports_between = []
            for edge in edges:
                if edge.edge_type == EdgeType.IMPORTS:
                    src_node = next((n for n in nodes if n.id == edge.source), None)
                    tgt_node = next((n for n in nodes if n.id == edge.target), None)
                    if src_node and tgt_node:
                        src_file_check = src_node.file_path
                        tgt_file_check = tgt_node.file_path
                        if src_file_check == src_module and tgt_file_check == tgt_module:
                            imports_between.append(src_node.name)

            module_deps.append(ModuleDependency(
                source_module=src_module,
                target_module=tgt_module,
                import_type="internal",
                imports=imports_between,
                edge_count=len(imports_between) if imports_between else 1
            ))

    # Also check for cross-file imports via external dependency resolution
    # (already handled in parser_factory._extract_cross_file_edges)

    return module_deps, file_deps


def find_circular_dependencies(
    nodes: list[CodeNode],
    edges: list[CodeEdge]
) -> list[CircularDependency]:
    """Find circular import dependencies at module level."""
    builder = CodeGraphBuilder()
    builder.build(nodes, edges)

    # Get file-level import cycles
    cycles = builder.find_circular_imports()

    circular_deps = []
    for cycle in cycles:
        # Convert to file paths for readability
        file_cycle = []
        for node_id in cycle:
            node = next((n for n in nodes if n.id == node_id), None)
            if node and node.node_type == NodeType.FILE or node:
                file_cycle.append(node.file_path)

        # Deduplicate consecutive files
        deduped = []
        for f in file_cycle:
            if not deduped or deduped[-1] != f:
                deduped.append(f)

        if len(deduped) >= 2:
            severity = "high" if len(deduped) <= 3 else "medium"
            if len(deduped) > 5:
                severity = "low"

            circular_deps.append(CircularDependency(
                cycle=deduped,
                cycle_type="import",
                severity=severity,
                description=f"Circular import chain: {' -> '.join(deduped)}"
            ))

    return circular_deps


def analyze_dependencies(
    repo_id: str,
    repo_path: Path,
    nodes: list[CodeNode],
    edges: list[CodeEdge]
) -> DependenciesAnalysisResult:
    """Main entry point for dependencies analysis."""
    from datetime import datetime, timezone

    # Find circular dependencies
    circular_deps = find_circular_dependencies(nodes, edges)

    # Build module dependency graph
    module_deps, file_deps = build_module_dependency_graph(nodes, edges, repo_path)

    # Extract external dependencies
    external_deps = extract_external_deps_from_imports(nodes, edges, repo_path)

    # Language breakdown
    language_breakdown = {}
    file_nodes = [n for n in nodes if n.node_type == NodeType.FILE]
    for fnode in file_nodes:
        lang = fnode.language
        if lang not in language_breakdown:
            language_breakdown[lang] = {"files": 0, "internal_deps": 0, "external_deps": 0}
        language_breakdown[lang]["files"] += 1

    # Count internal deps per language
    for dep in module_deps:
        src_lang = "unknown"
        for fnode in file_nodes:
            if fnode.file_path == dep.source_module:
                src_lang = fnode.language
                break
        if src_lang in language_breakdown:
            language_breakdown[src_lang]["internal_deps"] += 1

    # Count external deps per language
    for dep in external_deps:
        if dep.language in language_breakdown:
            language_breakdown[dep.language]["external_deps"] += 1

    # Build graph data for frontend (React Flow format)
    builder = CodeGraphBuilder()
    builder.build(nodes, edges)
    graph_data = builder.export_for_frontend(max_nodes=200)

    # Add module-level graph for dependency view
    module_graph = _build_module_graph_for_frontend(nodes, file_deps, module_deps)
    graph_data["moduleGraph"] = module_graph

    return DependenciesAnalysisResult(
        repository_id=repo_id,
        total_internal_modules=len(file_nodes),
        total_external_dependencies=len(external_deps),
        circular_dependencies=circular_deps,
        module_dependencies=module_deps,
        external_dependencies=external_deps,
        dependency_graph_data=graph_data,
        language_breakdown=language_breakdown,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def _build_module_graph_for_frontend(
    nodes: list[CodeNode],
    file_deps: dict[str, set[str]],
    module_deps: list[ModuleDependency]
) -> dict[str, Any]:
    """Build a module-level graph for React Flow visualization."""
    file_nodes = [n for n in nodes if n.node_type == NodeType.FILE]

    rf_nodes = []
    for fnode in file_nodes:
        rf_nodes.append({
            "id": fnode.id,
            "type": "moduleNode",
            "data": {
                "label": fnode.name,
                "fullLabel": fnode.qualified_name,
                "filePath": fnode.file_path,
                "language": fnode.language,
                "nodeCount": sum(1 for n in nodes if n.file_path == fnode.file_path),
            },
            "position": {"x": 0, "y": 0},
        })

    rf_edges = []
    for dep in module_deps:
        src_id = f"file:{dep.source_module}"
        tgt_id = f"file:{dep.target_module}"
        rf_edges.append({
            "id": f"{src_id}-{tgt_id}",
            "source": src_id,
            "target": tgt_id,
            "type": "moduleEdge",
            "data": {
                "imports": dep.imports,
                "edgeCount": dep.edge_count,
            },
            "animated": True,
            "style": {"stroke": "#8b5cf6", "strokeWidth": 1 + min(dep.edge_count / 5, 3)},
        })

    return {
        "nodes": rf_nodes,
        "edges": rf_edges,
    }


def get_dependency_stats(nodes: list[CodeNode], edges: list[CodeEdge]) -> dict[str, Any]:
    """Get quick dependency statistics."""
    builder = CodeGraphBuilder()
    builder.build(nodes, edges)

    circular = builder.find_circular_imports()
    dead_code = builder.find_dead_code()
    hotspots = builder.find_hotspots()

    import_edges = [e for e in edges if e.edge_type == EdgeType.IMPORTS]
    call_edges = [e for e in edges if e.edge_type == EdgeType.CALLS]

    return {
        "total_imports": len(import_edges),
        "total_calls": len(call_edges),
        "circular_import_count": len(circular),
        "dead_code_count": len(dead_code),
        "hotspot_count": len(hotspots),
        "file_count": len([n for n in nodes if n.node_type == NodeType.FILE]),
    }