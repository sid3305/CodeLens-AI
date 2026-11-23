from pathlib import Path

from tree_sitter import Language, Parser
from tree_sitter import Node as TSNode

from utils.code_graph.base import BaseParser, ParserRegistry
from utils.code_graph.models import CodeEdge, CodeNode, EdgeType, NodeType

# Load JavaScript/TypeScript grammars
try:
    import tree_sitter_javascript as tsjavascript
    import tree_sitter_typescript as tstypescript
    JS_LANGUAGE = Language(tsjavascript.language())
    TS_LANGUAGE = Language(tstypescript.language_typescript())
    TSX_LANGUAGE = Language(tstypescript.language_tsx())
except (ImportError, OSError, TypeError, ValueError):  # grammar missing or incompatible
    JS_LANGUAGE = None
    TS_LANGUAGE = None
    TSX_LANGUAGE = None


class JavaScriptParser(BaseParser):
    """Tree-sitter based JavaScript/TypeScript parser."""

    def __init__(self):
        self.js_parser = Parser()
        self.ts_parser = Parser()
        self.tsx_parser = Parser()

        if JS_LANGUAGE:
            self.js_parser.language = JS_LANGUAGE
        if TS_LANGUAGE:
            self.ts_parser.language = TS_LANGUAGE
        if TSX_LANGUAGE:
            self.tsx_parser.language = TSX_LANGUAGE

    def _get_parser(self, file_path: Path) -> Parser:
        """Get appropriate parser based on file extension."""
        ext = file_path.suffix.lower()
        if ext in [".ts", ".tsx"]:
            return self.tsx_parser if ext == ".tsx" else self.ts_parser
        return self.js_parser

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
        return "javascript"

    @property
    def file_extensions(self) -> list[str]:
        return [".js", ".jsx", ".ts", ".tsx"]

    def parse_file(self, file_path: Path, content: str) -> list[CodeNode]:
        parser = self._get_parser(file_path)
        language = self._detect_language(file_path)

        if not self._has_language(language):
            return []

        nodes = []
        repo_rel_path = str(file_path)

        tree = self._parse(parser, content)
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
        self._extract_nodes(root, content, repo_rel_path, nodes, file_node.id, language)

        return nodes

    def _has_language(self, language: str) -> bool:
        if language == "typescript":
            return TS_LANGUAGE is not None or TSX_LANGUAGE is not None
        return JS_LANGUAGE is not None

    def _detect_language(self, file_path: Path) -> str:
        ext = file_path.suffix.lower()
        if ext in [".ts", ".tsx"]:
            return "typescript"
        return "javascript"

    def _extract_nodes(self, node: TSNode, content: str, file_path: str,
                       nodes: list[CodeNode], parent_id: str, language: str) -> None:
        """Recursively extract nodes from AST."""

        # Functions, methods and classes handle their own bodies and return:
        # falling through to the generic recursion would visit those bodies
        # again with the outer parent and duplicate every nested definition.
        if node.type in ("function_declaration", "function_expression", "arrow_function",
                         "generator_function_declaration", "method_definition",
                         "class_declaration", "class"):
            if node.type == "method_definition":
                definition = self._make_method_node(node, content, file_path, parent_id, language)
            elif node.type in ("class_declaration", "class"):
                definition = self._make_class_node(node, content, file_path, parent_id, language)
            else:
                definition = self._make_function_node(node, content, file_path, parent_id, language)

            if definition:
                nodes.append(definition)
            body = node.child_by_field_name("body")
            if body:
                owner = definition.id if definition else parent_id
                self._extract_nodes(body, content, file_path, nodes, owner, language)
            return

        # Variable declarations (const/let/var at module level)
        if node.type in ("variable_declaration", "lexical_declaration"):
            if self._is_module_level(node):
                var_nodes = self._make_variable_nodes(node, content, file_path, parent_id, language)
                nodes.extend(var_nodes)

        # Export statements
        elif node.type == "export_statement":
            self._handle_export(node, content, file_path, nodes, parent_id, language)

        # Recurse into all children (handlers at top will process relevant types)
        for child in node.children:
            self._extract_nodes(child, content, file_path, nodes, parent_id, language)

    def _make_function_node(self, node: TSNode, content: str, file_path: str,
                            parent_id: str, language: str) -> CodeNode | None:
        name_node = node.child_by_field_name("name")
        if name_node is None and node.parent is not None and node.parent.type == "variable_declarator":
            # const name = () => {} / const name = function () {}
            name_node = node.parent.child_by_field_name("name")
        if name_node is None:
            # Anonymous callbacks get no node of their own; their calls are
            # attributed to the enclosing named function.
            return None
        name = content[name_node.start_byte:name_node.end_byte]

        qualified_name = self._build_qualified_name(parent_id, name)

        params_node = node.child_by_field_name("parameters") or node.child_by_field_name("parameter")
        parameters = self._extract_js_parameters(params_node, content) if params_node else []

        is_async = any(child.type == "async" for child in node.children)

        return CodeNode(
            id=f"func:{qualified_name}",
            name=name,
            qualified_name=qualified_name,
            node_type=NodeType.FUNCTION,
            file_path=file_path,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            language=language,
            parameters=parameters,
            is_async=is_async,
            is_entry_point=self._is_entry_point(name, node, content),
            is_exported=self._is_exported(node),
        )

    def _make_method_node(self, node: TSNode, content: str, file_path: str,
                          parent_id: str, language: str) -> CodeNode | None:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None

        name = content[name_node.start_byte:name_node.end_byte]
        qualified_name = self._build_qualified_name(parent_id, name)

        params_node = node.child_by_field_name("parameters")
        parameters = self._extract_js_parameters(params_node, content) if params_node else []

        is_async = any(child.type == "async" for child in node.children)

        return CodeNode(
            id=f"method:{qualified_name}",
            name=name,
            qualified_name=qualified_name,
            node_type=NodeType.METHOD,
            file_path=file_path,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            language=language,
            parameters=parameters,
            is_async=is_async,
            is_entry_point=False,
            is_exported=self._is_exported(node),
        )

    def _make_class_node(self, node: TSNode, content: str, file_path: str,
                         parent_id: str, language: str) -> CodeNode | None:
        name_node = node.child_by_field_name("name")
        if not name_node:
            return None

        name = content[name_node.start_byte:name_node.end_byte]
        qualified_name = self._build_qualified_name(parent_id, name)

        return CodeNode(
            id=f"class:{qualified_name}",
            name=name,
            qualified_name=qualified_name,
            node_type=NodeType.CLASS,
            file_path=file_path,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            language=language,
            is_entry_point=False,
            is_exported=self._is_exported(node),
        )

    def _make_variable_nodes(self, node: TSNode, content: str, file_path: str,
                             parent_id: str, language: str) -> list[CodeNode]:
        nodes = []
        # const/let/var x = ...
        declarators = [c for c in node.children if c.type in ("variable_declarator", "lexical_declaration")]
        for decl in declarators:
            name_node = decl.child_by_field_name("name")
            if name_node:
                name = content[name_node.start_byte:name_node.end_byte]
                if not name.startswith("_"):  # Public vars
                    qualified_name = self._build_qualified_name(parent_id, name)
                    nodes.append(CodeNode(
                        id=f"var:{qualified_name}",
                        name=name,
                        qualified_name=qualified_name,
                        node_type=NodeType.VARIABLE,
                        file_path=file_path,
                        line_start=node.start_point[0] + 1,
                        line_end=node.end_point[0] + 1,
                        language=language,
                        is_exported=self._is_exported(node),
                    ))
        return nodes

    def _handle_export(self, node: TSNode, content: str, file_path: str,
                       nodes: list[CodeNode], parent_id: str, language: str) -> None:
        """Mark exported nodes."""
        declaration = node.child_by_field_name("declaration")
        # Find the node we already created and mark it exported
        if declaration and declaration.type in ("function_declaration", "class_declaration"):
            name_node = declaration.child_by_field_name("name")
            if name_node:
                name = content[name_node.start_byte:name_node.end_byte]
                qualified_name = self._build_qualified_name(parent_id, name)
                for n in nodes:
                    if n.qualified_name == qualified_name:
                        n.is_exported = True

    def extract_edges(self, nodes: list[CodeNode], content: str) -> list[CodeEdge]:
        edges = []
        file_nodes = [n for n in nodes if n.node_type == NodeType.FILE]

        if not file_nodes:
            return edges

        file_node = file_nodes[0]
        file_path = file_node.file_path

        parser = self._get_parser(Path(file_path))
        tree = self._parse(parser, content)
        root = tree.root_node

        func_nodes = {n.qualified_name: n for n in nodes if n.node_type in (NodeType.FUNCTION, NodeType.METHOD)}
        class_nodes = {n.qualified_name: n for n in nodes if n.node_type == NodeType.CLASS}

        self._extract_call_edges(root, content, file_path, func_nodes, class_nodes, edges)
        self._extract_containment_edges(nodes, edges)

        return edges

    def _extract_call_edges(self, node: TSNode, content: str, file_path: str,
                            func_nodes: dict[str, CodeNode],
                            class_nodes: dict[str, CodeNode],
                            edges: list[CodeEdge]) -> None:
        if node.type == "call_expression":
            func = node.child_by_field_name("function")
            if func:
                callee_name = self._get_js_call_name(func, content)
                if callee_name:
                    matched = self._match_call_to_function(callee_name, func_nodes, class_nodes, file_path)
                    if matched:
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

    def _get_js_call_name(self, node: TSNode, content: str) -> str | None:
        if node.type == "identifier":
            return content[node.start_byte:node.end_byte]
        elif node.type == "member_expression":
            # obj.method() -> "method"
            prop = node.child_by_field_name("property")
            if prop:
                return content[prop.start_byte:prop.end_byte]
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
        parent = node.parent
        while parent:
            if parent.type in ("function_declaration", "function_expression", "arrow_function", "method_definition"):
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

    def _build_qualified_name(self, parent_id: str, name: str) -> str:
        """'pkg/mod.py:Class.method' from the parent's id ('file:', 'class:', ...)."""
        kind, _, parent = parent_id.partition(":")
        if kind == "file":
            return f"{parent}:{name}"
        return f"{parent}.{name}"

    def _extract_js_parameters(self, params_node: TSNode, content: str) -> list[str]:
        if params_node.type == "identifier":  # x => x * 2
            return [content[params_node.start_byte:params_node.end_byte]]

        params = []
        for child in params_node.named_children:
            if child.type in ("required_parameter", "optional_parameter"):
                child = child.child_by_field_name("pattern") or child
            if child.type == "assignment_pattern":  # b = 2
                child = child.child_by_field_name("left") or child
            if child.type in ("identifier", "rest_pattern", "object_pattern", "array_pattern"):
                params.append(content[child.start_byte:child.end_byte])
        return params

    def _is_module_level(self, node: TSNode) -> bool:
        parent = node.parent
        while parent:
            if parent.type in ("function_declaration", "function_expression",
                               "arrow_function", "class_declaration", "method_definition"):
                return False
            parent = parent.parent
        return True

    def _is_entry_point(self, name: str, node: TSNode, content: str) -> bool:
        # Main entry points: default exports, functions named main, test files
        return name == "main" or "test" in name.lower()

    def _is_exported(self, node: TSNode) -> bool:
        # Check if parent is export_statement
        parent = node.parent
        while parent:
            if parent.type == "export_statement":
                return True
            parent = parent.parent
        return False


# Register parsers
if JS_LANGUAGE:
    ParserRegistry.register(JavaScriptParser())