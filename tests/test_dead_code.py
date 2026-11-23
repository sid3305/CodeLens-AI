"""B9: the legacy Streamlit UI and empty stubs stay removed."""

from tests.conftest import PROJECT_ROOT

SOURCE_DIRS = ["backend", "utils", "agents", "prompts"]


def _python_sources():
    for directory in SOURCE_DIRS:
        yield from (PROJECT_ROOT / directory).rglob("*.py")
    yield from PROJECT_ROOT.glob("*.py")


def test_streamlit_is_not_a_dependency():
    requirements = (PROJECT_ROOT / "requirements.txt").read_text(encoding="utf-8")
    assert "streamlit" not in requirements.lower()


def test_no_module_imports_streamlit():
    offenders = [
        path.relative_to(PROJECT_ROOT).as_posix()
        for path in _python_sources()
        if "import streamlit" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_every_router_module_defines_a_router():
    routers = PROJECT_ROOT / "backend" / "routers"
    empty = [
        path.name
        for path in routers.glob("*.py")
        if path.name != "__init__.py" and "APIRouter(" not in path.read_text(encoding="utf-8")
    ]
    assert empty == []
