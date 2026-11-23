from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class NodeType(str, Enum):
    """Types of nodes in the code graph."""
    FILE = "file"
    MODULE = "module"
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    VARIABLE = "variable"
    IMPORT = "import"
    EXTERNAL_DEPENDENCY = "external_dependency"


class EdgeType(str, Enum):
    """Types of edges in the code graph."""
    CONTAINS = "contains"           # File contains class/function
    CALLS = "calls"                 # Function calls function (likely)
    IMPORTS = "imports"             # File imports module
    INHERITS = "inherits"           # Class inherits from class
    DEFINES = "defines"             # Module defines symbol
    REFERENCES = "references"       # Symbol references symbol
    EXTERNAL_CALL = "external_call" # Calls external library


@dataclass
class CodeNode:
    """A node in the code graph."""
    id: str                          # Unique identifier (e.g., "file:path/to/file.py" or "func:module.Class.method")
    name: str                        # Short name (e.g., "MyClass", "my_function")
    qualified_name: str              # Fully qualified (e.g., "mymodule.MyClass.my_method")
    node_type: NodeType
    file_path: str                   # Repository-relative path
    line_start: int
    line_end: int
    language: str                    # "python", "javascript", "typescript"

    # Optional metadata
    complexity: int | None = None           # Cyclomatic complexity
    parameters: list[str] = field(default_factory=list)
    return_type: str | None = None
    decorators: list[str] = field(default_factory=list)
    is_async: bool = False
    is_entry_point: bool = False               # main(), exported, test, etc.
    is_exported: bool = False
    docstring: str | None = None

    # Computed metrics (filled by graph analysis)
    fan_in: int = 0                            # Number of incoming CALLS edges
    fan_out: int = 0                           # Number of outgoing CALLS edges
    centrality: float = 0.0                    # Betweenness centrality

    def __hash__(self):
        return hash(self.id)

    def __eq__(self, other):
        if not isinstance(other, CodeNode):
            return False
        return self.id == other.id


@dataclass
class CodeEdge:
    """An edge in the code graph."""
    source: str                      # Source node ID
    target: str                      # Target node ID
    edge_type: EdgeType
    confidence: str = "likely"       # "certain" | "likely" | "possible"
    line: int | None = None       # Source line where edge originates
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class FileSummary:
    """Summary of a file's graph information."""
    file_path: str
    language: str
    lines_of_code: int
    node_count: int
    function_count: int
    class_count: int
    import_count: int
    complexity_total: int
    complexity_average: float
    external_dependencies: list[str] = field(default_factory=list)


@dataclass
class GraphSummary:
    """Summary of the entire repository graph."""
    total_files: int
    total_nodes: int
    total_edges: int
    languages: dict[str, int]
    file_summaries: list[FileSummary]
    entry_points: list[str]                    # Node IDs of entry points
    circular_dependencies: list[list[str]]     # Cycles in import graph
    dead_code_nodes: list[str]                 # Node IDs with no incoming edges (not entry points)
    hotspots: list[str]                        # High complexity + high fan-in nodes