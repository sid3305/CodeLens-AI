from collections import defaultdict
from typing import Any

import networkx as nx

from utils.code_graph.models import (
    CodeEdge,
    CodeNode,
    EdgeType,
    NodeType,
)


class CodeGraphBuilder:
    """Builds and analyzes a NetworkX graph from parsed code nodes and edges."""

    def __init__(self):
        self.graph = nx.DiGraph()
        self.nodes_by_id: dict[str, CodeNode] = {}
        self.edges: list[CodeEdge] = []

    def build(self, nodes: list[CodeNode], edges: list[CodeEdge]) -> nx.DiGraph:
        """Build the NetworkX graph from nodes and edges."""
        self.graph.clear()
        self.nodes_by_id = {n.id: n for n in nodes}
        self.edges = edges

        # Add nodes
        for node in nodes:
            self.graph.add_node(node.id, **self._node_attributes(node))

        # Add edges
        for edge in edges:
            if edge.source in self.nodes_by_id and edge.target in self.nodes_by_id:
                self.graph.add_edge(
                    edge.source,
                    edge.target,
                    **self._edge_attributes(edge)
                )

        return self.graph

    def _node_attributes(self, node: CodeNode) -> dict[str, Any]:
        return {
            "name": node.name,
            "qualified_name": node.qualified_name,
            "node_type": node.node_type.value,
            "file_path": node.file_path,
            "line_start": node.line_start,
            "line_end": node.line_end,
            "language": node.language,
            "complexity": node.complexity,
            "parameters": node.parameters,
            "return_type": node.return_type,
            "decorators": node.decorators,
            "is_async": node.is_async,
            "is_entry_point": node.is_entry_point,
            "is_exported": node.is_exported,
            "docstring": node.docstring,
        }

    def _edge_attributes(self, edge: CodeEdge) -> dict[str, Any]:
        return {
            "edge_type": edge.edge_type.value,
            "confidence": edge.confidence,
            "line": edge.line,
            "metadata": edge.metadata,
        }

    # Analysis methods

    def get_import_graph(self) -> nx.DiGraph:
        """Get subgraph of only IMPORTS edges (file-level dependencies)."""
        import_edges = [
            (e.source, e.target) for e in self.edges
            if e.edge_type == EdgeType.IMPORTS
        ]
        G = nx.DiGraph()
        G.add_edges_from(import_edges)
        return G

    def get_call_graph(self) -> nx.DiGraph:
        """Get subgraph of only CALLS edges."""
        call_edges = [
            (e.source, e.target) for e in self.edges
            if e.edge_type == EdgeType.CALLS
        ]
        G = nx.DiGraph()
        G.add_edges_from(call_edges)
        return G

    def get_containment_graph(self) -> nx.DiGraph:
        """Get subgraph of CONTAINS edges (hierarchy)."""
        contain_edges = [
            (e.source, e.target) for e in self.edges
            if e.edge_type == EdgeType.CONTAINS
        ]
        G = nx.DiGraph()
        G.add_edges_from(contain_edges)
        return G

    def find_circular_imports(self) -> list[list[str]]:
        """Find circular import dependencies."""
        import_graph = self.get_import_graph()
        try:
            cycles = list(nx.simple_cycles(import_graph))
            return cycles
        except nx.NetworkXException:
            return []

    def find_dead_code(self, exclude_entry_points: bool = True,
                       exclude_exported: bool = True) -> list[str]:
        """Find functions/classes with no incoming call edges."""
        call_graph = self.get_call_graph()
        dead = []

        for node_id, node in self.nodes_by_id.items():
            if node.node_type in (NodeType.FUNCTION, NodeType.METHOD, NodeType.CLASS):
                has_incoming = call_graph.in_degree(node_id) > 0 if node_id in call_graph else False
                is_entry = node.is_entry_point if exclude_entry_points else False
                is_exported = node.is_exported if exclude_exported else False

                if not has_incoming and not is_entry and not is_exported:
                    dead.append(node_id)

        return dead

    def calculate_centrality(self) -> dict[str, float]:
        """Calculate betweenness centrality for all nodes."""
        try:
            centrality = nx.betweenness_centrality(self.graph)
            return centrality
        except nx.NetworkXException:
            return {}

    def calculate_pagerank(self) -> dict[str, float]:
        """Calculate PageRank for all nodes."""
        try:
            pagerank = nx.pagerank(self.graph)
            return pagerank
        except nx.NetworkXException:
            return {}

    def get_fan_in(self, node_id: str) -> int:
        """Get number of incoming CALLS edges."""
        call_graph = self.get_call_graph()
        return call_graph.in_degree(node_id) if node_id in call_graph else 0

    def get_fan_out(self, node_id: str) -> int:
        """Get number of outgoing CALLS edges."""
        call_graph = self.get_call_graph()
        return call_graph.out_degree(node_id) if node_id in call_graph else 0

    def find_hotspots(self, min_complexity: int = 5, min_fan_in: int = 3) -> list[tuple[str, float]]:
        """Find complexity hotspots: high complexity + high fan-in."""
        call_graph = self.get_call_graph()
        hotspots = []

        for node_id, node in self.nodes_by_id.items():
            if (
                node.node_type in (NodeType.FUNCTION, NodeType.METHOD)
                and node.complexity
                and node.complexity >= min_complexity
            ):
                fan_in = call_graph.in_degree(node_id)
                if fan_in >= min_fan_in:
                    score = node.complexity * (1 + fan_in)
                    hotspots.append((node_id, score))

        hotspots.sort(key=lambda x: x[1], reverse=True)
        return hotspots

    def get_blast_radius(self, node_id: str, max_depth: int = 5) -> dict[str, Any]:
        """
        Get blast radius: what transitively depends on this node.
        Returns nodes reachable by reverse CALLS edges (callers of callers...).
        """
        if node_id not in self.graph:
            return {"nodes": [], "edges": [], "depth": 0}

        # Reverse graph for "what calls this"
        reverse_graph = self.graph.reverse()

        # BFS up to max_depth
        visited = set()
        current_level = {node_id}
        all_nodes = {node_id}
        blast_edges = []

        for depth in range(max_depth):
            next_level = set()
            for n in current_level:
                for pred in reverse_graph.predecessors(n):
                    if pred not in visited:
                        visited.add(pred)
                        next_level.add(pred)
                        all_nodes.add(pred)
                        blast_edges.append((pred, n))
            current_level = next_level
            if not current_level:
                break

        return {
            "nodes": list(all_nodes),
            "edges": blast_edges,
            "depth": depth + 1,
            "count": len(all_nodes) - 1,  # Exclude the source node
        }

    def get_downstream_impact(self, node_id: str, max_depth: int = 5) -> dict[str, Any]:
        """
        Get downstream impact: what this node transitively calls.
        """
        if node_id not in self.graph:
            return {"nodes": [], "edges": [], "depth": 0}

        visited = set()
        current_level = {node_id}
        all_nodes = {node_id}
        impact_edges = []

        for depth in range(max_depth):
            next_level = set()
            for n in current_level:
                for succ in self.graph.successors(n):
                    if succ not in visited:
                        visited.add(succ)
                        next_level.add(succ)
                        all_nodes.add(succ)
                        impact_edges.append((n, succ))
            current_level = next_level
            if not current_level:
                break

        return {
            "nodes": list(all_nodes),
            "edges": impact_edges,
            "depth": depth + 1,
            "count": len(all_nodes) - 1,
        }

    def get_module_dependencies(self) -> dict[str, set[str]]:
        """Get file-level import dependencies."""
        import_graph = self.get_import_graph()

        deps = defaultdict(set)
        for src, tgt in import_graph.edges():
            # Map to file nodes
            src_file = self._find_containing_file(src)
            tgt_file = self._find_containing_file(tgt)
            if src_file and tgt_file and src_file != tgt_file:
                deps[src_file].add(tgt_file)

        return dict(deps)

    def _find_containing_file(self, node_id: str) -> str | None:
        """Find the file node that contains this node."""
        # Walk up containment edges
        current = node_id
        while current in self.graph:
            node = self.nodes_by_id.get(current)
            if node and node.node_type == NodeType.FILE:
                return current
            # Check predecessors for CONTAINS edges
            preds = list(self.graph.predecessors(current))
            contains_preds = [p for p in preds if self.graph.edges[p, current].get("edge_type") == "contains"]
            if contains_preds:
                current = contains_preds[0]
            else:
                break
        return None

    def export_for_frontend(self, max_nodes: int = 300) -> dict[str, Any]:
        """Export graph in a format suitable for React Flow visualization."""
        # Select important nodes
        important_nodes = self._select_important_nodes(max_nodes)

        # Filter edges
        important_ids = {n.id for n in important_nodes}
        filtered_edges = [e for e in self.edges if e.source in important_ids and e.target in important_ids]

        # Convert to React Flow format
        rf_nodes = []
        for node in important_nodes:
            rf_nodes.append({
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
            })

        rf_edges = []
        for edge in filtered_edges:
            rf_edges.append({
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
                "style": {"stroke": _edge_color(edge.edge_type)},
            })

        return {
            "nodes": rf_nodes,
            "edges": rf_edges,
            "totalNodes": len(self.nodes_by_id),
            "totalEdges": len(self.edges),
            "showingNodes": len(important_nodes),
            "showingEdges": len(filtered_edges),
        }

    def _select_important_nodes(self, max_nodes: int) -> list[CodeNode]:
        """Select the most important nodes for visualization."""
        # Score nodes by: complexity + fan_in + centrality + is_entry_point
        centrality = self.calculate_centrality()

        scored = []
        for node in self.nodes_by_id.values():
            if node.node_type == NodeType.FILE:
                continue  # Handle files separately

            score = 0
            if node.complexity:
                score += node.complexity * 2
            score += self.get_fan_in(node.id) * 3
            score += self.get_fan_out(node.id)
            score += centrality.get(node.id, 0) * 100
            if node.is_entry_point:
                score += 50
            if node.is_exported:
                score += 20

            scored.append((score, node))

        scored.sort(key=lambda x: x[0], reverse=True)

        # Take top nodes, but ensure we have variety across files
        selected = []
        files_represented = set()

        for score, node in scored:
            if len(selected) >= max_nodes:
                break
            file_key = node.file_path
            if file_key not in files_represented or len(selected) < max_nodes // 2:
                selected.append(node)
                files_represented.add(file_key)

        # Always include file nodes
        file_nodes = [n for n in self.nodes_by_id.values() if n.node_type == NodeType.FILE]
        selected.extend(file_nodes)

        return selected


def _edge_color(edge_type: EdgeType) -> str:
    colors = {
        EdgeType.CONTAINS: "#64748b",
        EdgeType.CALLS: "#3b82f6",
        EdgeType.IMPORTS: "#8b5cf6",
        EdgeType.INHERITS: "#f59e0b",
        EdgeType.DEFINES: "#10b981",
        EdgeType.REFERENCES: "#ec4899",
        EdgeType.EXTERNAL_CALL: "#ef4444",
    }
    return colors.get(edge_type, "#64748b")