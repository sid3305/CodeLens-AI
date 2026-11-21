"""
CodeLens AI - Code Graph Module

Multi-language code parsing and graph analysis using Tree-sitter and NetworkX.
"""

from utils.code_graph.base import BaseParser, ParserRegistry
from utils.code_graph.models import (
    CodeNode,
    CodeEdge,
    NodeType,
    EdgeType,
    FileSummary,
    GraphSummary,
)
from utils.code_graph.parser_factory import (
    get_parser_for_file,
    get_supported_extensions,
    parse_repository,
    summarize_graph_for_frontend,
)
from utils.code_graph.graph_builder import CodeGraphBuilder

# Import parsers to register them
from utils.code_graph import python_parser  # noqa: F401
from utils.code_graph import javascript_parser  # noqa: F401

__all__ = [
    # Base
    "BaseParser",
    "ParserRegistry",

    # Models
    "CodeNode",
    "CodeEdge",
    "NodeType",
    "EdgeType",
    "FileSummary",
    "GraphSummary",

    # Factory
    "get_parser_for_file",
    "get_supported_extensions",
    "parse_repository",
    "summarize_graph_for_frontend",

    # Graph Builder
    "CodeGraphBuilder",
]