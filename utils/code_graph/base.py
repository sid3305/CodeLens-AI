from abc import ABC, abstractmethod
from pathlib import Path
from typing import ClassVar

from utils.code_graph.models import CodeEdge, CodeNode, FileSummary


class BaseParser(ABC):
    """Abstract base class for language-specific parsers."""

    @property
    @abstractmethod
    def language_name(self) -> str:
        """Language identifier (e.g., 'python', 'javascript', 'typescript')."""

    @property
    @abstractmethod
    def file_extensions(self) -> list[str]:
        """File extensions this parser handles (e.g., ['.py'], ['.js', '.jsx', '.ts', '.tsx'])."""

    @abstractmethod
    def parse_file(self, file_path: Path, content: str) -> list[CodeNode]:
        """
        Parse a single file and return all nodes found.

        Returns nodes for: files, classes, functions, methods, imports, variables.
        """

    @abstractmethod
    def extract_edges(self, nodes: list[CodeNode], content: str) -> list[CodeEdge]:
        """
        Extract edges (relationships) between nodes within a file.

        Returns edges for: CALLS, CONTAINS, IMPORTS, INHERITS, DEFINES, REFERENCES.
        """

    @abstractmethod
    def get_file_summary(self, file_path: Path, nodes: list[CodeNode]) -> FileSummary:
        """Generate a summary of the file's graph information."""

    # Common utility methods that can be overridden

    def is_entry_point(self, node: CodeNode) -> bool:
        """Determine if a node is an entry point (override per language)."""
        return False

    def is_exported(self, node: CodeNode) -> bool:
        """Determine if a node is exported/public (override per language)."""
        return False

    def calculate_complexity(self, node: CodeNode, content: str) -> int | None:
        """Calculate cyclomatic complexity (override per language)."""
        return None


class ParserRegistry:
    """Registry for language parsers."""

    _parsers: ClassVar[dict[str, BaseParser]] = {}

    @classmethod
    def register(cls, parser: BaseParser) -> None:
        """Register a parser for its language and extensions."""
        cls._parsers[parser.language_name] = parser
        for ext in parser.file_extensions:
            cls._parsers[ext] = parser

    @classmethod
    def get_parser(cls, language_or_extension: str) -> BaseParser | None:
        """Get parser by language name or file extension."""
        return cls._parsers.get(language_or_extension.lower())

    @classmethod
    def get_parser_for_file(cls, file_path: Path) -> BaseParser | None:
        """Get appropriate parser for a file path."""
        return cls.get_parser(file_path.suffix.lower())

    @classmethod
    def supported_languages(cls) -> list[str]:
        """Get list of supported language names."""
        return [p.language_name for p in set(cls._parsers.values())]