"""
CodeLens AI - Code Graph Module

- import_graph: file-level import graph (imports resolved and classified).
- parser_factory / graph_builder: function-level graph (definitions, calls).
- dependencies: the dependency report built from both.
"""

# Import parsers to register them
from utils.code_graph import (
    javascript_parser,  # noqa: F401
    python_parser,  # noqa: F401
)
from utils.code_graph.base import BaseParser, ParserRegistry
from utils.code_graph.graph_builder import CodeGraphBuilder
from utils.code_graph.models import CodeEdge, CodeNode, EdgeType, NodeType
from utils.code_graph.parser_factory import get_parser_for_file, parse_repository

__all__ = [
    "BaseParser",
    "CodeEdge",
    "CodeGraphBuilder",
    "CodeNode",
    "EdgeType",
    "NodeType",
    "ParserRegistry",
    "get_parser_for_file",
    "parse_repository",
]
