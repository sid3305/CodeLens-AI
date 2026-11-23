"""
CodeLens AI - Code Graph Module

Multi-language code parsing and graph analysis using Tree-sitter and NetworkX.
"""

# Import parsers to register them
from utils.code_graph import (
    javascript_parser,  # noqa: F401
    python_parser,  # noqa: F401
)
from utils.code_graph.base import BaseParser, ParserRegistry
from utils.code_graph.graph_builder import CodeGraphBuilder
from utils.code_graph.models import (
    CodeEdge,
    CodeNode,
    EdgeType,
    FileSummary,
    GraphSummary,
    NodeType,
)
from utils.code_graph.parser_factory import (
    get_parser_for_file,
    get_supported_extensions,
    parse_repository,
    summarize_graph_for_frontend,
)

__all__ = [
    # Base
    "BaseParser",
    "CodeEdge",
    # Graph Builder
    "CodeGraphBuilder",
    # Models
    "CodeNode",
    "EdgeType",
    "FileSummary",
    "GraphSummary",
    "NodeType",
    "ParserRegistry",
    # Factory
    "get_parser_for_file",
    "get_supported_extensions",
    "parse_repository",
    "summarize_graph_for_frontend",
]