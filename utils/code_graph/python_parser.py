from pathlib import Path

from tree_sitter import Language, Parser
from tree_sitter import Node as TSNode

from utils.code_graph.base import BaseParser, ParserRegistry
from utils.code_graph.models import CodeEdge, CodeNode, EdgeType, NodeType

# Load Python grammar
try:
    import tree_sitter_python as tspython
    PY_LANGUAGE = Language(tspython.language())
except (ImportError, OSError, TypeError, ValueError):  # grammar missing or incompatible
    PY_LANGUAGE = None


class PythonParser(BaseParser):
    """Tree-sitter based Python parser."""

    def __init__(self):
        self.parser = Parser()
        if PY_LANGUAGE:
            self.parser.language = PY_LANGUAGE

    def _parse(self, parser, content: str):
        """Parse once per file: parse_file and extract_edges share the tree."""
        cached = getattr(self, "_last_parse", None)
        if cached is not None and cached[0] is parser and cached[1] == content:
            return cached[2]
        tree = parser.parse(content.encode("utf-8"))
        self._last_parse = (parser, content, tree)
        return tree

    @property
    def language_name(self) -> str:
        return "python"

    @property
    def file_extensions(self) -> list[str]:
        return [".py"]

    def parse_file(self, file_path: Path, content: str) -> list[CodeNode]:
        if not PY_LANGUAGE:
            return []

        nodes = []
        repo_rel_path = str(file_path)
        language = "python"

        tree = self._parse(self.parser, content)
        root = tree.root_node

        # File node
        file_node = CodeNode(
            id=f"file:{repo_rel_path}",
            name=file_path.name,
            qualified_name=repo_rel_path,
            node_type=NodeType.FILE,
            file_path=repo_rel_path,
            line_start=1,
            line_end=len(content.splitlines()),
            language=language,
        )
        nodes.append(file_node)

        # Extract all definitions
        self._extract_nodes(root, content, repo_rel_path, nodes, file_node.id)

        return nodes

    def _extract_nodes(self, node: TSNode, content: str, file_path: str,
                       nodes: list[CodeNode], parent_id: str) -> None:
        """Recursively extract nodes from AST."""

        if node.type in ("function_definition", "class_definition"):
            if node.type == "function_definition":
                is_async = any(child.type == "async" for child in node.children)
                definition = self._make_function_node(
                    node, content, file_path, parent_id, is_async=is_async
                )
            else:
                definition = self._make_class_node(node, content, file_path, parent_id)

            if definition:
                nodes.append(definition)
                body = node.child_by_field_name("body")
                if body:
                    self._extract_nodes(body, content, file_path, nodes, definition.id)
            # The body was handled above; recursing again would duplicate
            # every nested definition at the outer level.
            return

        if node.type == "assignment" and self._is_module_level(node):
            # Module-level variable assignments
            var_nodes = self._make_variable_nodes(node, content, file_path, parent_id)
            nodes.extend(var_nodes)

        # Recurse into all children (handlers at top will process relevant types)
        for child in node.children:
            self._extract_nodes(child, content, file_path, nodes, parent_id)

    def _make_function_node(self, node: TSNode, content: str, file_path: str,
                            parent_id: str, is_async: bool = False) -> CodeNode | None:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None

        name = content[name_node.start_byte:name_node.end_byte]
        qualified_name = self._build_qualified_name(parent_id, name)

        params_node = node.child_by_field_name("parameters")
        parameters = self._extract_parameters(params_node, content) if params_node else []

        return_type = None
        returns_node = node.child_by_field_name("return_type")
        if returns_node:
            return_type = content[returns_node.start_byte:returns_node.end_byte]

        decorators = self._extract_decorators(node, content)

        complexity = self._calculate_complexity(node, content)

        is_method = parent_id.startswith("class:")

        return CodeNode(
            id=f"{'method' if is_method else 'func'}:{qualified_name}",
            name=name,
            qualified_name=qualified_name,
            node_type=NodeType.METHOD if is_method else NodeType.FUNCTION,
            file_path=file_path,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            language="python",
            complexity=complexity,
            parameters=parameters,
            return_type=return_type,
            decorators=decorators,
            is_async=is_async,
            is_entry_point=self._is_main_or_entry(node, content),
            is_exported=not name.startswith("_"),
        )

    def _make_class_node(self, node: TSNode, content: str, file_path: str,
                         parent_id: str) -> CodeNode | None:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None

        name = content[name_node.start_byte:name_node.end_byte]
        qualified_name = self._build_qualified_name(parent_id, name)

        # Base classes are not recorded yet (BUG-31: no INHERITS edges).

        decorators = self._extract_decorators(node, content)

        return CodeNode(
            id=f"class:{qualified_name}",
            name=name,
            qualified_name=qualified_name,
            node_type=NodeType.CLASS,
            file_path=file_path,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            language="python",
            decorators=decorators,
            is_entry_point=False,
            is_exported=not name.startswith("_"),
        )

    def _make_variable_nodes(self, node: TSNode, content: str, file_path: str,
                             parent_id: str) -> list[CodeNode]:
        nodes = []
        # Simple assignment: VAR = value
        left = node.child_by_field_name("left")
        if left and left.type == "identifier":
            name = content[left.start_byte:left.end_byte]
            if name.isupper() or not name.startswith("_"):  # Constants or public vars
                qualified_name = self._build_qualified_name(parent_id, name)
                nodes.append(CodeNode(
                    id=f"var:{qualified_name}",
                    name=name,
                    qualified_name=qualified_name,
                    node_type=NodeType.VARIABLE,
                    file_path=file_path,
                    line_start=node.start_point[0] + 1,
                    line_end=node.end_point[0] + 1,
                    language="python",
                    is_exported=not name.startswith("_"),
                ))
        return nodes

    def extract_edges(self, nodes: list[CodeNode], content: str) -> list[CodeEdge]:
        edges = []
        file_nodes = [n for n in nodes if n.node_type == NodeType.FILE]

        if not file_nodes:
            return edges

        file_node = file_nodes[0]
        file_path = file_node.file_path

        # Parse again for call extraction
        tree = self._parse(self.parser, content)
        root = tree.root_node

        # Build qualified name map for this file
        func_nodes = {n.qualified_name: n for n in nodes if n.node_type in (NodeType.FUNCTION, NodeType.METHOD)}
        class_nodes = {n.qualified_name: n for n in nodes if n.node_type == NodeType.CLASS}

        self._extract_call_edges(root, content, file_path, func_nodes, class_nodes, edges)
        self._extract_containment_edges(nodes, edges)

        return edges

    def _extract_call_edges(self, node: TSNode, content: str, file_path: str,
                            func_nodes: dict[str, CodeNode],
                            class_nodes: dict[str, CodeNode],
                            edges: list[CodeEdge]) -> None:
        """Extract function call edges within the file."""

        if node.type == "call":
            func = node.child_by_field_name("function")
            if func:
                callee_name = self._get_call_name(func, content)
                if callee_name:
                    # Try to match to a known function in this file
                    matched = self._match_call_to_function(callee_name, func_nodes, class_nodes, file_path)
                    if matched:
                        # Find caller (enclosing function)
                        caller = self._find_enclosing_function(node, content, func_nodes)
                        if caller:
                            edges.append(CodeEdge(
                                source=caller.id,
                                target=matched.id,
                                edge_type=EdgeType.CALLS,
                                confidence="likely",
                                line=node.start_point[0] + 1,
                            ))

        for child in node.children:
            self._extract_call_edges(child, content, file_path, func_nodes, class_nodes, edges)

    def _get_call_name(self, node: TSNode, content: str) -> str | None:
        """Extract the name being called."""
        if node.type == "identifier":
            return content[node.start_byte:node.end_byte]
        elif node.type == "attribute":
            # obj.method() -> return "method" for now
            attr = node.child_by_field_name("attribute")
            if attr:
                return content[attr.start_byte:attr.end_byte]
        return None

    def _match_call_to_function(self, call_name: str,
                                func_nodes: dict[str, CodeNode],
                                class_nodes: dict[str, CodeNode],
                                file_path: str) -> CodeNode | None:
        """Match a call name to a known function in the same file."""
        # Direct match - qualified names use : as separator
        for qname, node in func_nodes.items():
            if qname.endswith((f":{call_name}", f".{call_name}")) or qname == call_name:
                return node
        # Method on class
        for qname, node in class_nodes.items():
            if qname.endswith((f":{call_name}", f".{call_name}")):
                return node
        return None

    def _find_enclosing_function(self, node: TSNode, content: str,
                                 func_nodes: dict[str, CodeNode]) -> CodeNode | None:
        """Find the function that contains this call."""
        parent = node.parent
        while parent:
            if parent.type in ("function_definition", "async_function_definition"):
                name_node = parent.child_by_field_name("name")
                if name_node:
                    caller_name = content[name_node.start_byte:name_node.end_byte]
                    for qname, func_node in func_nodes.items():
                        if (qname.endswith((f":{caller_name}", f".{caller_name}")) or qname == caller_name) and \
                           func_node.line_start <= node.start_point[0] + 1 <= func_node.line_end:
                            return func_node
            parent = parent.parent
        return None

    def _extract_containment_edges(self, nodes: list[CodeNode], edges: list[CodeEdge]) -> None:
        """CONTAINS edges: file -> classes/functions, class -> methods."""
        file_nodes = [n for n in nodes if n.node_type == NodeType.FILE]
        if not file_nodes:
            return
        file_node = file_nodes[0]

        for node in nodes:
            if node.node_type in (NodeType.CLASS, NodeType.FUNCTION, NodeType.VARIABLE, NodeType.IMPORT):
                edges.append(CodeEdge(
                    source=file_node.id,
                    target=node.id,
                    edge_type=EdgeType.CONTAINS,
                    confidence="certain",
                ))
            elif node.node_type == NodeType.METHOD:
                # Find parent class
                class_prefix = ".".join(node.qualified_name.split(".")[:-1])
                for class_node in nodes:
                    if class_node.qualified_name == class_prefix and class_node.node_type == NodeType.CLASS:
                        edges.append(CodeEdge(
                            source=class_node.id,
                            target=node.id,
                            edge_type=EdgeType.CONTAINS,
                            confidence="certain",
                        ))
                        break

        # This would need more sophisticated parsing of base classes
        # For now, skip - can be enhanced later

    # Helper methods

    def _build_qualified_name(self, parent_id: str, name: str) -> str:
        """'pkg/mod.py:Class.method' from the parent's id ('file:', 'class:', ...)."""
        kind, _, parent = parent_id.partition(":")
        if kind == "file":
            return f"{parent}:{name}"
        return f"{parent}.{name}"

    def _extract_parameters(self, params_node: TSNode, content: str) -> list[str]:
        params = []
        for child in params_node.named_children:
            if child.type == "identifier":
                params.append(content[child.start_byte:child.end_byte])
            elif child.type in ("default_parameter", "typed_default_parameter"):
                name_node = child.child_by_field_name("name")
                if name_node:
                    params.append(content[name_node.start_byte:name_node.end_byte])
            elif child.type in (
                "typed_parameter", "list_splat_pattern", "dictionary_splat_pattern"
            ):
                text = content[child.start_byte:child.end_byte]
                params.append(text.split(":", 1)[0].strip())
        return params

    def _extract_decorators(self, node: TSNode, content: str) -> list[str]:
        # Decorators belong to the enclosing decorated_definition node.
        parent = node.parent
        holder = parent if parent is not None and parent.type == "decorated_definition" else node
        return [
            content[child.start_byte:child.end_byte].strip().removeprefix("@")
            for child in holder.children
            if child.type == "decorator"
        ]

    def _calculate_complexity(self, node: TSNode, content: str) -> int | None:
        """Simple cyclomatic complexity: 1 + number of decision points."""
        complexity = 1
        decision_types = {"if_statement", "elif_clause", "while_statement", "for_statement",
                          "except_clause", "with_statement", "assert_statement",
                          "conditional_expression", "boolean_operator"}

        def count_decisions(n: TSNode):
            nonlocal complexity
            if n.type in decision_types:
                complexity += 1
            for child in n.children:
                count_decisions(child)

        count_decisions(node)
        return complexity

    def _is_main_or_entry(self, node: TSNode, content: str) -> bool:
        name_node = node.child_by_field_name("name")
        if name_node:
            name = content[name_node.start_byte:name_node.end_byte]
            return name in ("main", "__main__") or name.startswith("test_")
        return False

    def _is_module_level(self, node: TSNode) -> bool:
        parent = node.parent
        while parent:
            if parent.type in ("function_definition", "class_definition"):
                return False
            parent = parent.parent
        return True


# Register the parser
if PY_LANGUAGE:
    ParserRegistry.register(PythonParser())