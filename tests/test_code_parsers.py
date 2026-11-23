"""Function-level parsers: definitions, containment, calls, complexity."""

from pathlib import PurePosixPath

import pytest

from utils.code_graph import CodeGraphBuilder, EdgeType, NodeType, parse_repository

PYTHON = '''\
import os

LIMIT = 10
first, second = 1, 2


def helper(value):
    return value * 2


@cache
@other.decorator
def compute(items, scale=1, *args, **kwargs):
    total = 0
    for item in items:
        if item > LIMIT and scale:
            total += helper(item)
        elif item:
            total -= 1
    return total


async def fetch(url):
    return await os.fspath(url)


class Service:
    """Does work."""

    class Config:
        retries = 3

    def run(self):
        return self.prepare() + compute([1, 2])

    def prepare(self):
        return helper(1)


def _private():
    return None


if __name__ == "__main__":
    Service().run()
'''

JAVASCRIPT = '''\
import { thing } from './thing'

const LIMIT = 10
let counter = 0

function helper(value) {
  return value * 2
}

export function compute(items) {
  let total = 0
  for (const item of items) {
    if (item > LIMIT) { total += helper(item) }
  }
  return total
}

export const arrow = (a, b = 2, ...rest) => compute([a, b, ...rest])

export default class Widget {
  render() {
    return this.paint() + helper(1)
  }

  paint() {
    return arrow(1)
  }
}

async function main() {
  return new Widget().render()
}
'''


def _parse(files):
    parsed = parse_repository(
        [PurePosixPath(path) for path in files], lambda path: files[path]
    )
    by_name = {node.qualified_name: node for node in parsed["nodes"]}
    return parsed, by_name


def _edges(parsed, edge_type):
    return {(e.source, e.target) for e in parsed["edges"] if e.edge_type == edge_type}


# --- Python --------------------------------------------------------------------


@pytest.fixture(scope="module")
def python():
    return _parse({"pkg/mod.py": PYTHON})


def test_python_definitions(python):
    _, nodes = python
    kinds = {name: node.node_type for name, node in nodes.items()}

    assert kinds["pkg/mod.py"] == NodeType.FILE
    assert kinds["pkg/mod.py:helper"] == NodeType.FUNCTION
    assert kinds["pkg/mod.py:compute"] == NodeType.FUNCTION
    assert kinds["pkg/mod.py:Service"] == NodeType.CLASS
    assert kinds["pkg/mod.py:Service.run"] == NodeType.METHOD
    assert kinds["pkg/mod.py:Service.Config"] == NodeType.CLASS
    assert kinds["pkg/mod.py:LIMIT"] == NodeType.VARIABLE
    assert not any(node.node_type == NodeType.IMPORT for node in nodes.values())


def test_python_function_details(python):
    _, nodes = python
    compute = nodes["pkg/mod.py:compute"]

    assert compute.parameters[:2] == ["items", "scale"]
    assert compute.decorators == ["cache", "other.decorator"]
    assert compute.complexity >= 4
    assert compute.line_start == 13
    assert nodes["pkg/mod.py:fetch"].is_async is True
    assert nodes["pkg/mod.py:_private"].is_exported is False
    assert nodes["pkg/mod.py:helper"].is_exported is True


def test_python_calls_and_containment(python):
    parsed, nodes = python
    calls = _edges(parsed, EdgeType.CALLS)
    contains = _edges(parsed, EdgeType.CONTAINS)

    def node_id(name):
        return nodes[name].id

    assert (node_id("pkg/mod.py:compute"), node_id("pkg/mod.py:helper")) in calls
    assert (node_id("pkg/mod.py:Service.prepare"), node_id("pkg/mod.py:helper")) in calls
    assert (node_id("pkg/mod.py:Service.run"), node_id("pkg/mod.py:compute")) in calls
    assert (node_id("pkg/mod.py"), node_id("pkg/mod.py:Service")) in contains
    assert (node_id("pkg/mod.py:Service"), node_id("pkg/mod.py:Service.run")) in contains


def test_python_graph_queries(python):
    parsed, nodes = python
    builder = CodeGraphBuilder()
    builder.build(parsed["nodes"], parsed["edges"])

    assert builder.get_fan_in(nodes["pkg/mod.py:helper"].id) == 2
    assert builder.get_fan_out(nodes["pkg/mod.py:compute"].id) == 1
    assert nodes["pkg/mod.py:_private"].id in builder.find_dead_code()
    assert builder.find_hotspots(min_complexity=1, min_fan_in=1)


# --- JavaScript / TypeScript -----------------------------------------------------


@pytest.fixture(scope="module")
def javascript():
    return _parse({"web/app.js": JAVASCRIPT})


def test_javascript_definitions(javascript):
    _, nodes = javascript
    kinds = {name: node.node_type for name, node in nodes.items()}

    assert kinds["web/app.js:helper"] == NodeType.FUNCTION
    assert kinds["web/app.js:compute"] == NodeType.FUNCTION
    assert kinds["web/app.js:Widget"] == NodeType.CLASS
    assert kinds["web/app.js:Widget.render"] == NodeType.METHOD
    assert kinds["web/app.js:main"] == NodeType.FUNCTION
    assert nodes["web/app.js:compute"].is_exported is True
    assert nodes["web/app.js:helper"].is_exported is False
    assert nodes["web/app.js:main"].is_async is True
    assert all(node.language == "javascript" for node in nodes.values())


def test_javascript_calls(javascript):
    parsed, nodes = javascript
    calls = _edges(parsed, EdgeType.CALLS)

    def node_id(name):
        return nodes[name].id

    assert (node_id("web/app.js:compute"), node_id("web/app.js:helper")) in calls
    assert (node_id("web/app.js:Widget.render"), node_id("web/app.js:helper")) in calls
    assert (node_id("web/app.js:Widget.render"), node_id("web/app.js:Widget.paint")) in calls


def test_typescript_and_tsx_are_parsed():
    _, nodes = _parse({
        "a.ts": "export function typed(x: number): number { return x }\n",
        "b.tsx": "export function View(): JSX.Element { return <div /> }\n",
    })

    assert nodes["a.ts:typed"].language == "typescript"
    assert nodes["b.tsx:View"].node_type == NodeType.FUNCTION


def test_unparseable_and_empty_files_are_skipped(caplog, monkeypatch):
    from utils.code_graph import python_parser

    def explode(*_args, **_kwargs):
        raise RuntimeError("grammar failure")

    monkeypatch.setattr(python_parser.PythonParser, "parse_file", explode)

    parsed, _ = _parse({"bad.py": "x = 1\n", "empty.js": "", "notes.md": "# x"})

    assert parsed["nodes"] == []
    assert "Skipping bad.py" in caplog.text


def test_graph_export_is_ranked_and_limited(python, javascript):
    nodes = python[0]["nodes"] + javascript[0]["nodes"]
    edges = python[0]["edges"] + javascript[0]["edges"]
    builder = CodeGraphBuilder()
    builder.build(nodes, edges)

    exported = builder.export_for_frontend(max_nodes=5)

    assert len(exported["nodes"]) == 5
    assert exported["showingNodes"] == 5
    assert exported["totalNodes"] == len(builder.nodes_by_id)
    shown = {node["id"] for node in exported["nodes"]}
    assert all(e["source"] in shown and e["target"] in shown for e in exported["edges"])
