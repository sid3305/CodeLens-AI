import logging
from pathlib import Path
from typing import Any

from utils.code_graph.base import BaseParser, ParserRegistry
from utils.code_graph.models import (
    CodeEdge,
    CodeNode,
    EdgeType,
    FileSummary,
    GraphSummary,
)

logger = logging.getLogger(__name__)

def get_parser_for_file(file_path: Path) -> BaseParser | None:
    """Get the appropriate parser for a file."""
    return ParserRegistry.get_parser_for_file(file_path)


def get_supported_extensions() -> list[str]:
    """Get all supported file extensions."""
    extensions = set()
    for parser in set(ParserRegistry._parsers.values()):
        if hasattr(parser, 'file_extensions'):
            extensions.update(parser.file_extensions)
    return sorted(extensions)


def parse_repository(file_paths: list[Path], read_file_func) -> dict[str, Any]:
    """
    Parse all files in a repository.

    Args:
        file_paths: List of file paths to parse
        read_file_func: Function to read file content (path -> content)

    Returns:
        Dict with 'nodes', 'edges', 'file_summaries', 'graph_summary'
    """
    all_nodes: list[CodeNode] = []
    all_edges: list[CodeEdge] = []
    file_summaries: list[FileSummary] = []

    for file_path in file_paths:
        parser = get_parser_for_file(file_path)
        if not parser:
            continue

        try:
            content = read_file_func(str(file_path))
            if not content or content.startswith("Error"):
                continue

            # Parse file
            nodes = parser.parse_file(file_path, content)
            all_nodes.extend(nodes)

            # Extract edges within file
            edges = parser.extract_edges(nodes, content)
            all_edges.extend(edges)

            # File summary
            summary = parser.get_file_summary(file_path, nodes)
            file_summaries.append(summary)

        # Tree-sitter grammars can fail in many ways on unusual input; one
        # unparseable file must not abort the whole repository.
        except Exception as error:  # noqa: BLE001
            logger.warning("Skipping %s: %s", file_path, error)
            continue

    # Cross-file edges (imports -> definitions)
    cross_file_edges = _extract_cross_file_edges(all_nodes)
    all_edges.extend(cross_file_edges)

    # Build graph summary
    graph_summary = _build_graph_summary(all_nodes, all_edges, file_summaries)

    return {
        "nodes": all_nodes,
        "edges": all_edges,
        "file_summaries": file_summaries,
        "graph_summary": graph_summary,
    }


def _extract_cross_file_edges(nodes: list[CodeNode]) -> list[CodeEdge]:
    """Extract edges between files (imports -> definitions)."""
    edges = []

    # Map of import name -> import node
    imports = {n.name: n for n in nodes if n.node_type.name == "IMPORT"}

    # Map of qualified name -> definition node
    definitions = {}
    for n in nodes:
        if n.node_type.name in ("FUNCTION", "METHOD", "CLASS", "VARIABLE"):
            # Also index by short name for matching
            definitions[n.name] = n
            definitions[n.qualified_name] = n

    for imp_name, imp_node in imports.items():
        if imp_name in definitions:
            target = definitions[imp_name]
            edges.append(CodeEdge(
                source=imp_node.id,
                target=target.id,
                edge_type=EdgeType.IMPORTS,
                confidence="likely",
                line=imp_node.line_start,
            ))

    return edges


def _build_graph_summary(nodes: list[CodeNode], edges: list[CodeEdge],
                         file_summaries: list[FileSummary]) -> GraphSummary:
    """Build a summary of the entire repository graph."""
    from collections import Counter

    # Language stats
    languages = Counter(n.language for n in nodes if n.node_type.name == "FILE")

    # Entry points
    entry_points = [n.id for n in nodes if n.is_entry_point]

    # Build adjacency for cycle detection
    import_edges = [(e.source, e.target) for e in edges if e.edge_type.name == "IMPORTS"]

    # Find circular dependencies (simple approach)
    circular_deps = _find_cycles(import_edges, nodes)

    # Find dead code (functions/classes with no incoming CALLS edges, not entry points)
    dead_code = _find_dead_code(nodes, edges)

    # Find hotspots (high complexity + high fan-in)
    hotspots = _find_hotspots(nodes, edges)

    return GraphSummary(
        total_files=len([n for n in nodes if n.node_type.name == "FILE"]),
        total_nodes=len(nodes),
        total_edges=len(edges),
        languages=dict(languages),
        file_summaries=file_summaries,
        entry_points=entry_points,
        circular_dependencies=circular_deps,
        dead_code_nodes=dead_code,
        hotspots=hotspots,
    )


def _find_cycles(import_edges: list[tuple], nodes: list[CodeNode]) -> list[list[str]]:
    """Find circular import dependencies."""
    import networkx as nx

    G = nx.DiGraph()
    node_by_id = {n.id: n for n in nodes}

    for src, tgt in import_edges:
        if src in node_by_id and tgt in node_by_id:
            G.add_edge(src, tgt)

    try:
        cycles = list(nx.simple_cycles(G))
        return cycles[:20]  # Limit to 20 cycles
    except nx.NetworkXException:
        return []


def _find_dead_code(nodes: list[CodeNode], edges: list[CodeEdge]) -> list[str]:
    """Find functions/classes with no incoming CALLS edges that aren't entry points/exported."""
    # Build incoming call count
    call_edges = [(e.source, e.target) for e in edges if e.edge_type.name == "CALLS"]
    incoming_calls = {}
    for src, tgt in call_edges:
        incoming_calls[tgt] = incoming_calls.get(tgt, 0) + 1

    dead = []
    for node in nodes:
        if (
            node.node_type.name in ("FUNCTION", "METHOD", "CLASS")
            and node.id not in incoming_calls
            and not node.is_entry_point
            and not node.is_exported
        ):
            dead.append(node.id)

    return dead[:50]  # Limit


def _find_hotspots(nodes: list[CodeNode], edges: list[CodeEdge]) -> list[str]:
    """Find high complexity + high fan-in nodes."""
    # Fan-in from CALLS edges
    call_edges = [(e.source, e.target) for e in edges if e.edge_type.name == "CALLS"]
    fan_in = {}
    for src, tgt in call_edges:
        fan_in[tgt] = fan_in.get(tgt, 0) + 1

    # Score = complexity * (1 + fan_in)
    scored = []
    for node in nodes:
        if node.node_type.name in ("FUNCTION", "METHOD") and node.complexity:
            fi = fan_in.get(node.id, 0)
            score = node.complexity * (1 + fi)
            scored.append((score, node.id))

    scored.sort(reverse=True)
    return [node_id for score, node_id in scored[:20]]  # Top 20


def summarize_graph_for_frontend(nodes: list[CodeNode], edges: list[CodeEdge],
                                  max_nodes: int = 300) -> dict[str, Any]:
    """
    Create a summarized graph for frontend visualization.
    Groups by folder, limits nodes, adds click-to-expand metadata.
    """
    from collections import defaultdict

    # Group nodes by folder
    folder_nodes = defaultdict(list)
    for node in nodes:
        if node.node_type.name == "FILE":
            continue  # Handle files separately
        folder = str(Path(node.file_path).parent)
        if folder == ".":
            folder = "root"
        folder_nodes[folder].append(node)

    # Select top nodes by importance (complexity + fan-in + centrality)
    # For now, take first N nodes per folder
    selected_nodes = []
    nodes_per_folder = max(1, max_nodes // max(1, len(folder_nodes)))

    for folder, fnodes in folder_nodes.items():
        # Sort by complexity + fan_in
        fnodes.sort(key=lambda n: (n.complexity or 0) + n.fan_in, reverse=True)
        selected_nodes.extend(fnodes[:nodes_per_folder])

    # Always include file nodes
    file_nodes = [n for n in nodes if n.node_type.name == "FILE"]
    selected_nodes.extend(file_nodes)

    # Filter edges to only include selected nodes
    selected_ids = {n.id for n in selected_nodes}
    selected_edges = [e for e in edges if e.source in selected_ids and e.target in selected_ids]

    # Convert to React Flow format
    react_flow_nodes = []
    for node in selected_nodes:
        react_flow_nodes.append({
            "id": node.id,
            "type": "codeNode",
            "data": {
                "label": node.name,
                "fullLabel": node.qualified_name,
                "nodeType": node.node_type.value,
                "filePath": node.file_path,
                "lineStart": node.line_start,
                "lineEnd": node.line_end,
                "language": node.language,
                "complexity": node.complexity,
                "fanIn": node.fan_in,
                "fanOut": node.fan_out,
                "isEntryPoint": node.is_entry_point,
                "isExported": node.is_exported,
            },
            "position": {"x": 0, "y": 0},  # Will be laid out by React Flow
        })

    react_flow_edges = []
    for edge in selected_edges:
        react_flow_edges.append({
            "id": f"{edge.source}-{edge.target}",
            "source": edge.source,
            "target": edge.target,
            "type": "codeEdge",
            "data": {
                "edgeType": edge.edge_type.value,
                "confidence": edge.confidence,
                "line": edge.line,
            },
            "animated": edge.edge_type.name == "CALLS",
            "style": {"stroke": _edge_color(edge.edge_type)},
        })

    return {
        "nodes": react_flow_nodes,
        "edges": react_flow_edges,
        "totalNodes": len(nodes),
        "totalEdges": len(edges),
        "showingNodes": len(selected_nodes),
        "showingEdges": len(selected_edges),
        "folders": list(folder_nodes.keys()),
    }


def _edge_color(edge_type) -> str:
    colors = {
        "CONTAINS": "#64748b",
        "CALLS": "#3b82f6",
        "IMPORTS": "#8b5cf6",
        "INHERITS": "#f59e0b",
        "DEFINES": "#10b981",
        "REFERENCES": "#ec4899",
        "EXTERNAL_CALL": "#ef4444",
    }
    return colors.get(edge_type.name, "#64748b")