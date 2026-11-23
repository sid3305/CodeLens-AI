"""
Function-level parsing with the registered Tree-sitter parsers.

Produces file, class, function, method and variable nodes with CONTAINS and
CALLS edges. Imports are not taken from here: the file-level import graph
(utils/code_graph/import_graph.py) resolves them properly.
"""

import logging
from collections.abc import Callable, Iterable
from pathlib import PurePath
from typing import Any

from utils.code_graph.base import BaseParser, ParserRegistry
from utils.code_graph.models import CodeEdge, CodeNode, NodeType

logger = logging.getLogger(__name__)


def get_parser_for_file(file_path: PurePath) -> BaseParser | None:
    """The registered parser for a file's extension, if any."""
    return ParserRegistry.get_parser_for_file(file_path)


def parse_repository(
    file_paths: Iterable[PurePath],
    read_file_func: Callable[[str], str],
) -> dict[str, Any]:
    """
    Parse files into code nodes and edges.

    ``file_paths`` should be repository-relative so node ids contain no
    local paths. Import nodes (and edges touching them) are dropped.
    """

    nodes: list[CodeNode] = []
    edges: list[CodeEdge] = []

    for file_path in file_paths:
        parser = get_parser_for_file(file_path)
        if not parser:
            continue

        content = read_file_func(str(file_path))
        if not content:
            continue

        # Tree-sitter grammars can fail in many ways on unusual input; one
        # unparseable file must not abort the whole repository.
        try:
            file_nodes = parser.parse_file(file_path, content)
            file_edges = parser.extract_edges(file_nodes, content)
        except Exception as error:  # noqa: BLE001
            logger.warning("Skipping %s: %s", file_path, error)
            continue

        import_ids = {n.id for n in file_nodes if n.node_type == NodeType.IMPORT}
        nodes.extend(n for n in file_nodes if n.id not in import_ids)
        edges.extend(
            e for e in file_edges
            if e.source not in import_ids and e.target not in import_ids
        )

    return {"nodes": nodes, "edges": edges}
