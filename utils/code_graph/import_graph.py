"""
File-level import graph for Python and JavaScript/TypeScript repositories.

Every import statement is extracted, resolved and classified as:

- ``internal``   resolves to a file (or namespace package) in the repository
- ``stdlib``     Python standard library or a Node.js built-in module
- ``external``   a third-party package
- ``unresolved`` looks local but cannot be resolved (never counted as a package)

Python imports are read with :mod:`ast`, which gives exact import forms and
precise syntax-error locations. JavaScript/TypeScript imports are read with
the Tree-sitter grammars. Files that do not parse are skipped and reported.

All paths are repository-relative POSIX paths.
"""

from __future__ import annotations

import ast
import json
import posixpath
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import networkx as nx
from tree_sitter import Language, Parser

try:
    import tree_sitter_javascript
    import tree_sitter_typescript

    _JS = Language(tree_sitter_javascript.language())
    _TS = Language(tree_sitter_typescript.language_typescript())
    _TSX = Language(tree_sitter_typescript.language_tsx())
except (ImportError, OSError, TypeError, ValueError):  # pragma: no cover - grammar missing
    _JS = _TS = _TSX = None


PYTHON_EXTENSIONS = frozenset({".py"})
TYPESCRIPT_EXTENSIONS = frozenset({".ts", ".tsx", ".mts", ".cts"})
JAVASCRIPT_EXTENSIONS = frozenset({".js", ".jsx", ".mjs", ".cjs"}) | TYPESCRIPT_EXTENSIONS

# Extension probing order for extensionless relative specifiers.
_JS_RESOLVE_EXTENSIONS = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
# TypeScript ESM code imports './x.js' while the source file is './x.ts'.
_TS_SOURCE_FOR = {
    ".js": (".ts", ".tsx"),
    ".jsx": (".tsx",),
    ".mjs": (".mts",),
    ".cjs": (".cts",),
}

PYTHON_STDLIB = frozenset(sys.stdlib_module_names) | {"__future__", "__main__"}

NODE_BUILTINS = frozenset({
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
    "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
    "events", "fs", "http", "http2", "https", "inspector", "module", "net",
    "os", "path", "perf_hooks", "process", "punycode", "querystring",
    "readline", "repl", "sea", "sqlite", "stream", "string_decoder", "sys",
    "test", "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm",
    "wasi", "worker_threads", "zlib",
})

# Import names whose PyPI distribution has a different name.
PYTHON_DISTRIBUTIONS = {
    "attr": "attrs",
    "bs4": "beautifulsoup4",
    "crypto": "pycryptodome",
    "cv2": "opencv-python",
    "dateutil": "python-dateutil",
    "docx": "python-docx",
    "dotenv": "python-dotenv",
    "fitz": "pymupdf",
    "git": "gitpython",
    "jwt": "pyjwt",
    "magic": "python-magic",
    "multipart": "python-multipart",
    "mysqldb": "mysqlclient",
    "openssl": "pyopenssl",
    "pil": "pillow",
    "pptx": "python-pptx",
    "serial": "pyserial",
    "skimage": "scikit-image",
    "sklearn": "scikit-learn",
    "yaml": "pyyaml",
}

_NAMESPACE = "<namespace package>"
_URL_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


def normalise_distribution(name: str) -> str:
    """PEP 503 normalisation: 'PyYAML' and 'py_yaml' both become 'pyyaml'."""

    return re.sub(r"[-_.]+", "-", name).lower()


def python_distribution(import_name: str) -> str:
    top = import_name.split(".")[0]
    return normalise_distribution(PYTHON_DISTRIBUTIONS.get(top.lower(), top))


def npm_package(specifier: str) -> str:
    """'@scope/pkg/deep' -> '@scope/pkg'; 'lodash/fp' -> 'lodash'."""

    parts = specifier.split("/")
    if specifier.startswith("@") and len(parts) > 1:
        return "/".join(parts[:2])
    return parts[0]


def language_of(path: str) -> str | None:
    suffix = posixpath.splitext(path)[1].lower()
    if suffix in PYTHON_EXTENSIONS:
        return "python"
    if suffix in TYPESCRIPT_EXTENSIONS:
        return "typescript"
    if suffix in JAVASCRIPT_EXTENSIONS:
        return "javascript"
    return None


# --- Data model ----------------------------------------------------------------


@dataclass
class ResolvedImport:
    source: str
    line: int
    specifier: str
    names: list[str]
    language: str
    kind: str
    category: str = "unresolved"
    target: str | None = None
    package: str | None = None
    reason: str | None = None


@dataclass
class SkippedFile:
    path: str
    reason: str


@dataclass
class ExternalPackage:
    name: str
    language: str
    files: list[str] = field(default_factory=list)
    import_count: int = 0


@dataclass
class ImportGraph:
    files: list[str]
    languages: dict[str, str]
    imports: list[ResolvedImport]
    skipped: list[SkippedFile]

    def internal_edges(self) -> dict[tuple[str, str], list[ResolvedImport]]:
        edges: dict[tuple[str, str], list[ResolvedImport]] = defaultdict(list)
        for item in self.imports:
            if item.category == "internal" and item.target and item.target in self.languages:
                edges[(item.source, item.target)].append(item)
        return dict(edges)

    def file_graph(self) -> nx.DiGraph:
        graph = nx.DiGraph()
        graph.add_nodes_from(self.files)
        graph.add_edges_from(self.internal_edges())
        return graph

    def cyclic_groups(self) -> list[tuple[list[str], list[str]]]:
        """
        Import cycles as (ordered cycle, all files in the strongly connected
        component). Uses SCCs, so cost is linear in the graph size.
        """

        graph = self.file_graph()
        groups = []

        for component in nx.strongly_connected_components(graph):
            members = sorted(component)

            if len(members) == 1:
                node = members[0]
                if graph.has_edge(node, node):
                    groups.append(([node], members))
                continue

            subgraph = graph.subgraph(component)
            order = [edge[0] for edge in nx.find_cycle(subgraph, source=members[0])]
            groups.append((order, members))

        return sorted(groups, key=lambda group: (len(group[1]), group[1]))

    def cycles(self) -> list[list[str]]:
        return [order for order, _ in self.cyclic_groups()]

    def external_packages(self) -> dict[str, ExternalPackage]:
        packages: dict[str, ExternalPackage] = {}
        for item in self.imports:
            if item.category != "external" or not item.package:
                continue
            ecosystem = "python" if item.language == "python" else "javascript"
            package = packages.setdefault(
                item.package, ExternalPackage(name=item.package, language=ecosystem)
            )
            package.import_count += 1
            if item.source not in package.files:
                package.files.append(item.source)
        for package in packages.values():
            package.files.sort()
        return dict(sorted(packages.items()))

    def unresolved(self) -> list[ResolvedImport]:
        return [item for item in self.imports if item.category == "unresolved"]


# --- Extraction ----------------------------------------------------------------


def _extract_python(path: str, content: str) -> list[ResolvedImport]:
    tree = ast.parse(content, filename=path)
    found = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.append(
                    ResolvedImport(path, node.lineno, alias.name, [], "python", "import")
                )
        elif isinstance(node, ast.ImportFrom):
            specifier = "." * node.level + (node.module or "")
            names = [alias.name for alias in node.names]
            found.append(ResolvedImport(path, node.lineno, specifier, names, "python", "from"))

    return sorted(found, key=lambda item: item.line)


_PARSERS: dict[str, Parser] = {}


def _js_parser(path: str) -> Parser | None:
    suffix = posixpath.splitext(path)[1].lower()
    language = {".ts": _TS, ".mts": _TS, ".cts": _TS, ".tsx": _TSX}.get(suffix, _JS)
    if language is None:  # pragma: no cover - grammar missing
        return None
    key = str(id(language))
    if key not in _PARSERS:
        _PARSERS[key] = Parser(language)
    return _PARSERS[key]


def _string_value(node) -> str | None:
    if node is None or node.type != "string":
        return None
    return node.text.decode("utf-8", errors="replace")[1:-1]


def _first_error_line(node) -> int:
    stack = [node]
    while stack:
        current = stack.pop()
        if current.type == "ERROR" or current.is_missing:
            return current.start_point[0] + 1
        stack.extend(reversed(current.children))
    return node.start_point[0] + 1


def _named_imports(node) -> list[str]:
    names = []
    stack = [node]
    while stack:
        current = stack.pop()
        if current.type in ("import_specifier", "export_specifier"):
            name = current.child_by_field_name("name")
            if name is not None:
                names.append(name.text.decode("utf-8", errors="replace"))
            continue
        if current.type == "namespace_import" or current.type == "namespace_export":
            names.append("*")
            continue
        if current.type == "identifier" and current.parent is not None and current.parent.type == "import_clause":
            names.append(current.text.decode("utf-8", errors="replace"))
            continue
        stack.extend(current.children)
    return names


def _extract_javascript(path: str, content: str, language: str) -> list[ResolvedImport]:
    parser = _js_parser(path)
    if parser is None:  # pragma: no cover - grammar missing
        return []

    tree = parser.parse(content.encode("utf-8"))
    root = tree.root_node
    if root.has_error:
        raise SyntaxError(f"syntax error (line {_first_error_line(root)})")

    found = []
    stack = [root]

    while stack:
        node = stack.pop()
        line = node.start_point[0] + 1

        if node.type in ("import_statement", "export_statement"):
            specifier = _string_value(node.child_by_field_name("source"))
            if specifier is not None:
                kind = "import" if node.type == "import_statement" else "export"
                found.append(
                    ResolvedImport(path, line, specifier, _named_imports(node), language, kind)
                )
        elif node.type == "call_expression":
            function = node.child_by_field_name("function")
            arguments = node.child_by_field_name("arguments")
            if function is not None and arguments is not None:
                is_require = function.type == "identifier" and function.text == b"require"
                is_dynamic = function.type == "import"
                literal = [child for child in arguments.named_children]
                if (is_require or is_dynamic) and len(literal) == 1:
                    specifier = _string_value(literal[0])
                    if specifier is not None:
                        kind = "require" if is_require else "dynamic"
                        found.append(ResolvedImport(path, line, specifier, [], language, kind))

        stack.extend(node.children)

    return sorted(found, key=lambda item: item.line)


# --- Resolution ----------------------------------------------------------------


def _strip_json_comments(text: str) -> str:
    """Remove // and /* */ comments and trailing commas (tsconfig is JSONC)."""

    out = []
    index = 0
    in_string = False

    while index < len(text):
        char = text[index]
        if in_string:
            out.append(char)
            if char == "\\" and index + 1 < len(text):
                out.append(text[index + 1])
                index += 1
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
            out.append(char)
        elif text.startswith("//", index):
            newline = text.find("\n", index)
            index = len(text) if newline == -1 else newline
            continue
        elif text.startswith("/*", index):
            end = text.find("*/", index + 2)
            index = len(text) if end == -1 else end + 2
            continue
        else:
            out.append(char)
        index += 1

    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


@dataclass
class _PathConfig:
    """compilerOptions from one tsconfig.json / jsconfig.json."""

    directory: str
    base_url: str | None
    paths: list[tuple[str, str, list[str]]]  # (prefix, suffix, targets)


class _Resolver:
    def __init__(self, root: Path, files: list[str]):
        self.root = root
        self.files = set(files)

        self.python_dirs: set[str] = set()
        for path in files:
            if path.endswith(".py"):
                directory = posixpath.dirname(path)
                while directory:
                    self.python_dirs.add(directory)
                    directory = posixpath.dirname(directory)

        self.primary_roots = [""]
        if "src" in self.python_dirs:
            self.primary_roots.append("src")

        # Parents of top-level packages anywhere in the tree (monorepos,
        # e.g. backend/app/__init__.py imported as `app`).
        extra = set()
        for path in files:
            if path.endswith("/__init__.py"):
                package = posixpath.dirname(path)
                parent = posixpath.dirname(package)
                if not self._is_package(parent):
                    extra.add(parent)
        self.extra_roots = sorted(extra - set(self.primary_roots))

        self.path_configs = self._load_path_configs(files)
        self._config_cache: dict[str, _PathConfig | None] = {}

    # Python ----------------------------------------------------------------

    def _is_package(self, directory: str) -> bool:
        return bool(directory) and _join(directory, "__init__.py") in self.files

    def _python_lookup(self, base: str, parts: list[str]) -> str | None:
        path = _join(base, *parts)
        if f"{path}.py" in self.files:
            return f"{path}.py"
        if _join(path, "__init__.py") in self.files:
            return _join(path, "__init__.py")
        if path in self.python_dirs:
            return _NAMESPACE
        return None

    def _absolute_python(self, importer: str, parts: list[str]) -> tuple[str, str | None]:
        roots = list(self.primary_roots)
        script_dir = posixpath.dirname(importer)
        if not self._is_package(script_dir) and script_dir not in roots:
            roots.insert(0, script_dir)

        for base in roots:
            found = self._python_lookup(base, parts)
            if found:
                return base, found

        if parts[0] in PYTHON_STDLIB:
            return "", "<stdlib>"

        for base in self.extra_roots:
            found = self._python_lookup(base, parts)
            if found:
                return base, found

        return "", None

    def _is_local_top_level(self, importer: str, name: str) -> bool:
        roots = [*self.primary_roots, posixpath.dirname(importer), *self.extra_roots]
        return any(self._python_lookup(base, [name]) for base in roots)

    def resolve_python(self, item: ResolvedImport) -> list[ResolvedImport]:
        level = len(item.specifier) - len(item.specifier.lstrip("."))
        module = item.specifier[level:]
        parts = module.split(".") if module else []

        if level:
            base = posixpath.dirname(item.source)
            for _ in range(level - 1):
                if not base:
                    return [_unresolved(item, "relative import goes beyond the repository root")]
                base = posixpath.dirname(base)
            module_file = self._python_lookup(base, parts) if parts else (
                _join(base, "__init__.py") if self._is_package(base) else _NAMESPACE
            )
            if module_file is None:
                return [_unresolved(item, "relative import target not found")]
            package_dir = _join(base, *parts)
        else:
            base, module_file = self._absolute_python(item.source, parts)
            if module_file == "<stdlib>":
                return [_classified(item, "stdlib", package=parts[0])]
            if module_file is None:
                if self._is_local_top_level(item.source, parts[0]):
                    return [_unresolved(item, f"module '{module}' not found in the repository")]
                return [_classified(item, "external", package=python_distribution(parts[0]))]
            package_dir = _join(base, *parts)

        if item.kind != "from":
            return [_internal(item, module_file)]

        # `from package import name`: a name may be a submodule (its own file)
        # or an attribute of the package/module itself.
        results = []
        attributes = []
        by_target: dict[str, list[str]] = defaultdict(list)

        for name in item.names:
            submodule = None
            if name != "*" and (module_file == _NAMESPACE or module_file.endswith("__init__.py")):
                submodule = self._python_lookup(package_dir, [name])
            if submodule and submodule != _NAMESPACE:
                by_target[submodule].append(name)
            else:
                attributes.append(name)

        for target, names in by_target.items():
            results.append(_internal(item, target, names=names))

        if attributes or not by_target:
            results.append(_internal(item, module_file, names=attributes))

        return results

    # JavaScript / TypeScript -----------------------------------------------

    def _load_path_configs(self, files: list[str]) -> dict[str, _PathConfig]:
        configs = {}
        for path in files:
            if posixpath.basename(path) not in ("tsconfig.json", "jsconfig.json"):
                continue
            directory = posixpath.dirname(path)
            if directory in configs:  # tsconfig.json wins over jsconfig.json
                continue
            try:
                raw = (self.root / path).read_text(encoding="utf-8", errors="replace")
                options = json.loads(_strip_json_comments(raw)).get("compilerOptions") or {}
            except (OSError, ValueError, AttributeError):
                continue

            base_url = options.get("baseUrl")
            base = _normalise(_join(directory, base_url)) if isinstance(base_url, str) else None
            mapping_base = base if base is not None else directory

            patterns = []
            for pattern, targets in (options.get("paths") or {}).items():
                if not isinstance(targets, list):
                    continue
                prefix, star, suffix = pattern.partition("*")
                resolved_targets = [
                    _normalise(_join(mapping_base, target))
                    for target in targets
                    if isinstance(target, str)
                ]
                patterns.append((prefix, suffix if star else None, resolved_targets))

            # Longest prefix first, like TypeScript.
            patterns.sort(key=lambda entry: len(entry[0]), reverse=True)
            configs[directory] = _PathConfig(directory, base, patterns)
        return configs

    def _config_for(self, importer: str) -> _PathConfig | None:
        directory = posixpath.dirname(importer)
        if directory in self._config_cache:
            return self._config_cache[directory]

        current = directory
        found = None
        while True:
            if current in self.path_configs:
                found = self.path_configs[current]
                break
            if not current:
                break
            current = posixpath.dirname(current)

        self._config_cache[directory] = found
        return found

    def _js_file(self, path: str | None) -> str | None:
        if path is None:
            return None
        if path in self.files:
            return path
        stem, suffix = posixpath.splitext(path)
        for source_suffix in _TS_SOURCE_FOR.get(suffix.lower(), ()):
            if stem + source_suffix in self.files:
                return stem + source_suffix
        for extension in _JS_RESOLVE_EXTENSIONS:
            if path + extension in self.files:
                return path + extension
        for extension in _JS_RESOLVE_EXTENSIONS:
            index = _join(path, f"index{extension}")
            if index in self.files:
                return index
        return None

    def resolve_javascript(self, item: ResolvedImport) -> list[ResolvedImport]:
        spec = item.specifier

        if spec.startswith("node:") or spec.split("/")[0] in NODE_BUILTINS:
            return [_classified(item, "stdlib", package=spec.removeprefix("node:").split("/")[0])]

        if spec in (".", "..") or spec.startswith(("./", "../")):
            target = _normalise(_join(posixpath.dirname(item.source), spec))
            if target is None:
                return [_unresolved(item, "relative import goes beyond the repository root")]
            found = self._js_file(target)
            if found:
                return [_internal(item, found)]
            return [_unresolved(item, "relative import target not found")]

        if spec.startswith("/"):
            return [_unresolved(item, "absolute filesystem imports are not supported")]
        if spec.startswith("#"):
            return [_unresolved(item, "package.json 'imports' aliases are not supported")]
        if _URL_SCHEME.match(spec):
            return [_unresolved(item, "URL imports are not resolved")]

        config = self._config_for(item.source)
        if config:
            for prefix, suffix, targets in config.paths:
                if suffix is None:
                    if spec != prefix:
                        continue
                    wildcard = ""
                elif spec.startswith(prefix) and spec.endswith(suffix) and len(spec) >= len(prefix) + len(suffix):
                    wildcard = spec[len(prefix): len(spec) - len(suffix)]
                else:
                    continue

                for target in targets:
                    found = self._js_file(_normalise(target.replace("*", wildcard)) if target else None)
                    if found:
                        return [_internal(item, found)]
                return [_unresolved(item, "path alias matched but its target was not found")]

            if config.base_url is not None:
                found = self._js_file(_normalise(_join(config.base_url, spec)))
                if found:
                    return [_internal(item, found)]

        return [_classified(item, "external", package=npm_package(spec))]


def _join(*parts: str) -> str:
    return posixpath.join(*[part for part in parts if part])


def _normalise(path: str) -> str | None:
    """Normalise a repository-relative path; None if it leaves the repository."""

    normalised = posixpath.normpath(path) if path else ""
    if normalised == ".":
        return ""
    if normalised == ".." or normalised.startswith(("../", "/")):
        return None
    return normalised


def _classified(item: ResolvedImport, category: str, *, package: str | None = None) -> ResolvedImport:
    item.category = category
    item.package = package
    return item


def _internal(item: ResolvedImport, target: str, *, names: list[str] | None = None) -> ResolvedImport:
    return ResolvedImport(
        source=item.source,
        line=item.line,
        specifier=item.specifier,
        names=list(item.names if names is None else names),
        language=item.language,
        kind=item.kind,
        category="internal",
        target=None if target == _NAMESPACE else target,
    )


def _unresolved(item: ResolvedImport, reason: str) -> ResolvedImport:
    item.category = "unresolved"
    item.reason = reason
    return item


# --- Entry point ---------------------------------------------------------------


def build_import_graph(root: Path, files: list[str]) -> ImportGraph:
    """
    Build the import graph for ``files`` (repository-relative POSIX paths
    under ``root``). Non-Python/JS files are used only for resolution
    (e.g. tsconfig.json, JSON imports).
    """

    root = Path(root)
    resolver = _Resolver(root, files)

    parsed: list[str] = []
    languages: dict[str, str] = {}
    imports: list[ResolvedImport] = []
    skipped: list[SkippedFile] = []

    for path in sorted(files):
        language = language_of(path)
        if language is None:
            continue

        try:
            content = (root / path).read_text(encoding="utf-8", errors="replace")
        except OSError as error:
            skipped.append(SkippedFile(path, f"unreadable: {error.strerror or error}"))
            continue

        try:
            if language == "python":
                found = _extract_python(path, content)
            else:
                found = _extract_javascript(path, content, language)
        except SyntaxError as error:
            detail = getattr(error, "msg", None) or str(error)
            line = getattr(error, "lineno", None)
            reason = f"SyntaxError: {detail}" + (f" (line {line})" if line and "line" not in detail else "")
            skipped.append(SkippedFile(path, reason))
            continue
        except ValueError as error:  # e.g. source containing null bytes
            skipped.append(SkippedFile(path, f"cannot parse: {error}"))
            continue

        parsed.append(path)
        languages[path] = language

        for item in found:
            if language == "python":
                imports.extend(resolver.resolve_python(item))
            else:
                imports.extend(resolver.resolve_javascript(item))

    return ImportGraph(files=parsed, languages=languages, imports=imports, skipped=skipped)
