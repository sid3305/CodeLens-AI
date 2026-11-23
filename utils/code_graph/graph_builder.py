"""
Function-level code graph (files, classes, functions, calls).

Everything derived from the graph is computed once in :meth:`build`, so
every query afterwards is a dictionary lookup. Node importance uses degree
(connectivity) rather than betweenness centrality, which is O(V·E) and made
a 2,000-file repository take minutes.
"""

from collections import defaultdict
from typing import Any

import networkx as nx

from utils.code_graph.models import CodeEdge, CodeNode, EdgeType, NodeType

_EDGE_COLORS = {
    EdgeType.CONTAINS: "#64748b",
    EdgeType.CALLS: "#3b82f6",
    EdgeType.IMPORTS: "#8b5cf6",
    EdgeType.INHERITS: "#f59e0b",
    EdgeType.DEFINES: "#10b981",
}


class CodeGraphBuilder:
    """Builds a NetworkX graph from parsed nodes/edges and answers queries on it."""

    def __init__(self):
        self.graph = nx.DiGraph()
        self.nodes_by_id: dict[str, CodeNode] = {}
        self.nodes_by_file: dict[str, list[CodeNode]] = {}
        self.edges: list[CodeEdge] = []
        self._calls_in: dict[str, int] = {}
        self._calls_out: dict[str, int] = {}

    def build(self, nodes: list[CodeNode], edges: list[CodeEdge]) -> nx.DiGraph:
        self.graph = nx.DiGraph()
        self.nodes_by_id = {node.id: node for node in nodes}

        by_file: dict[str, list[CodeNode]] = defaultdict(list)
        for node in nodes:
            by_file[node.file_path].append(node)
            self.graph.add_node(node.id)
        self.nodes_by_file = dict(by_file)

        # Keep only edges between known nodes (parsers may reference
        # call targets that were never defined).
        self.edges = [
            edge for edge in edges
            if edge.source in self.nodes_by_id and edge.target in self.nodes_by_id
        ]

        calls_in: dict[str, int] = defaultdict(int)
        calls_out: dict[str, int] = defaultdict(int)
        for edge in self.edges:
            self.graph.add_edge(edge.source, edge.target, edge_type=edge.edge_type.value)
            if edge.edge_type == EdgeType.CALLS:
                calls_in[edge.target] += 1
                calls_out[edge.source] += 1
        self._calls_in = dict(calls_in)
        self._calls_out = dict(calls_out)

        return self.graph

    # --- Queries ------------------------------------------------------------

    def get_fan_in(self, node_id: str) -> int:
        """Number of incoming CALLS edges."""
        return self._calls_in.get(node_id, 0)

    def get_fan_out(self, node_id: str) -> int:
        """Number of outgoing CALLS edges."""
        return self._calls_out.get(node_id, 0)

    def find_dead_code(self, exclude_entry_points: bool = True,
                       exclude_exported: bool = True) -> list[str]:
        """Functions/classes with no incoming call edges (a heuristic)."""
        dead = []
        for node_id, node in self.nodes_by_id.items():
            if node.node_type not in (NodeType.FUNCTION, NodeType.METHOD, NodeType.CLASS):
                continue
            if self.get_fan_in(node_id):
                continue
            if exclude_entry_points and node.is_entry_point:
                continue
            if exclude_exported and node.is_exported:
                continue
            dead.append(node_id)
        return dead

    def find_hotspots(self, min_complexity: int = 5, min_fan_in: int = 3) -> list[tuple[str, float]]:
        """High complexity combined with high fan-in, most severe first."""
        hotspots = []
        for node_id, node in self.nodes_by_id.items():
            if node.node_type not in (NodeType.FUNCTION, NodeType.METHOD):
                continue
            fan_in = self.get_fan_in(node_id)
            if node.complexity and node.complexity >= min_complexity and fan_in >= min_fan_in:
                hotspots.append((node_id, node.complexity * (1 + fan_in)))
        hotspots.sort(key=lambda item: item[1], reverse=True)
        return hotspots

    # --- Export -------------------------------------------------------------

    def _importance(self, node: CodeNode) -> float:
        score = float(self.graph.degree(node.id))
        score += (node.complexity or 0) * 2
        score += self.get_fan_in(node.id) * 3
        if node.is_entry_point:
            score += 50
        if node.is_exported:
            score += 20
        return score

    def _select_important_nodes(self, max_nodes: int) -> list[CodeNode]:
        """At most ``max_nodes`` nodes (files included), most important first."""
        ranked = sorted(
            self.nodes_by_id.values(),
            key=lambda node: (-self._importance(node), node.id),
        )
        return ranked[:max_nodes]

    def export_for_frontend(self, max_nodes: int = 300) -> dict[str, Any]:
        """React Flow nodes/edges for the most important part of the graph."""
        selected = self._select_important_nodes(max_nodes)
        selected_ids = {node.id for node in selected}
        shown_edges = [
            edge for edge in self.edges
            if edge.source in selected_ids and edge.target in selected_ids
        ]

        nodes = [
            {
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
                    "fanIn": self.get_fan_in(node.id),
                    "fanOut": self.get_fan_out(node.id),
                    "isEntryPoint": node.is_entry_point,
                    "isExported": node.is_exported,
                },
                "position": {"x": 0, "y": 0},
            }
            for node in selected
        ]

        edges = [
            {
                "id": f"{edge.source}-{edge.target}",
                "source": edge.source,
                "target": edge.target,
                "type": "codeEdge",
                "data": {
                    "edgeType": edge.edge_type.value,
                    "confidence": edge.confidence,
                    "line": edge.line,
                },
                "animated": edge.edge_type == EdgeType.CALLS,
                "style": {"stroke": _EDGE_COLORS.get(edge.edge_type, "#94a3b8")},
            }
            for edge in shown_edges
        ]

        return {
            "nodes": nodes,
            "edges": edges,
            "totalNodes": len(self.nodes_by_id),
            "totalEdges": len(self.edges),
            "showingNodes": len(nodes),
            "showingEdges": len(edges),
        }
