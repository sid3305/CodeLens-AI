"""A4 / BUG-01: the core install must work on native Windows."""

import re

from tests.conftest import PROJECT_ROOT

# Packages that cannot be installed from PyPI on native Windows.
WINDOWS_INCOMPATIBLE = {"semgrep"}


def _requirement_lines(name):
    lines = (PROJECT_ROOT / name).read_text(encoding="utf-8").splitlines()
    return [
        line.split("#", 1)[0].strip()
        for line in lines
        if line.split("#", 1)[0].strip()
    ]


def _package(line):
    return re.split(r"[\s\[<>=!~;]", line, maxsplit=1)[0].lower()


def test_core_requirements_install_on_windows():
    packages = {_package(line) for line in _requirement_lines("requirements.txt")}
    assert not packages & WINDOWS_INCOMPATIBLE


def test_optional_analyzers_are_guarded_by_platform_marker():
    for line in _requirement_lines("requirements-analyzers.txt"):
        if _package(line) in WINDOWS_INCOMPATIBLE:
            assert 'sys_platform != "win32"' in line, line
