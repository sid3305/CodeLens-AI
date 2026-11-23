"""
D1: dependency analysis performance on a generated 2,000-file repository.

Targets: < 2 s cold, < 100 ms cached. The asserted budgets carry a wide
margin so slower CI machines do not make the test flaky; the measured
timings are written to the pytest report via ``record_property``.
"""

import time

import pytest

from backend.services import dependency_service
from tests.helpers import upload_repo

FILE_COUNT = 2_000
COLD_BUDGET_SECONDS = 6.0  # target 2 s
CACHED_BUDGET_SECONDS = 0.5  # target 0.1 s


def generated_repository(file_count: int = FILE_COUNT) -> dict[str, str]:
    """Half Python, half TypeScript, with cross-package imports, calls and classes."""

    half = file_count // 2
    files: dict[str, str] = {}

    for package in range(half // 50):
        files[f"pkg{package}/__init__.py"] = ""

    for i in range(half):
        target = (i + 7) % half
        sibling = (i // 50) * 50 + (i + 1) % 50
        files[f"pkg{i // 50}/m{i}.py"] = (
            "import os\n"
            "import json\n"
            "import requests\n"
            f"from pkg{target // 50}.m{target} import f{target}\n"
            f"from .m{sibling} import C{sibling}\n\n"
            f"def f{i}(value):\n"
            "    if value > 1:\n"
            "        return helper(value - 1)\n"
            "    return os.getcwd()\n\n"
            "def helper(value):\n"
            "    for item in range(value):\n"
            "        if item % 2:\n"
            "            return item\n"
            "    return json.dumps(value)\n\n"
            f"class C{i}:\n"
            "    def run(self):\n"
            f"        return f{i}(3)\n"
        )

    for i in range(half):
        target = (i + 11) % half
        files[f"web/dir{i // 50}/c{i}.ts"] = (
            "import React from 'react'\n"
            "import { join } from 'node:path'\n"
            f"import {{ g{target} }} from '../dir{target // 50}/c{target}'\n\n"
            f"export function g{i}(value: number): number {{\n"
            "  if (value > 1) { return helper(value - 1) }\n"
            "  return join('a', 'b').length\n"
            "}\n\n"
            "function helper(value: number): number {\n"
            "  return value * 2\n"
            "}\n\n"
            f"export class K{i} {{\n"
            f"  run() {{ return g{i}(3) + g{target}(1) }}\n"
            "}\n"
        )

    return files


@pytest.mark.perf
def test_two_thousand_file_repository_meets_the_budget(client, monkeypatch, record_property):
    repo = upload_repo(client, generated_repository())
    assert repo["file_count"] == FILE_COUNT + FILE_COUNT // 2 // 50

    def timed(func):
        started = time.perf_counter()
        result = func()
        return result, time.perf_counter() - started

    report, cold = timed(lambda: dependency_service.get_dependency_report(repo["id"]))
    cached, memory = timed(lambda: dependency_service.get_dependency_report(repo["id"]))

    # Simulate a server restart: only the persisted file is left.
    monkeypatch.setattr(dependency_service, "_memory", type(dependency_service._memory)())
    _, disk = timed(lambda: dependency_service.get_dependency_report(repo["id"]))

    url = f"/api/repositories/{repo['id']}/dependencies"
    response, http = timed(lambda: client.get(url))

    for name, seconds in [("cold", cold), ("cached_memory", memory),
                          ("cached_disk", disk), ("cached_http", http)]:
        record_property(f"{name}_seconds", round(seconds, 4))

    assert response.status_code == 200
    assert cached["stats"] == report["stats"]
    assert report["total_internal_modules"] == FILE_COUNT + FILE_COUNT // 2 // 50
    # The wrap-around imports form one large Python and one large TS cycle.
    assert len(report["circular_dependencies"]) >= 2
    assert {p["name"] for p in report["external_dependencies"]} == {"requests", "react"}

    assert cold < COLD_BUDGET_SECONDS, f"cold analysis took {cold:.2f}s"
    assert memory < CACHED_BUDGET_SECONDS, f"cached read took {memory * 1000:.0f}ms"
    assert disk < CACHED_BUDGET_SECONDS, f"read after restart took {disk * 1000:.0f}ms"
    assert http < 2 * CACHED_BUDGET_SECONDS, f"cached HTTP response took {http * 1000:.0f}ms"
