"""Shared pytest fixtures.

Every test runs with:
- live LLM access disabled (no key, and the Groq client raises if constructed);
- the repository store redirected to a per-test temporary directory;
- the interpreter's script directory on PATH so Ruff and Bandit resolve.
"""

import os
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"

# Make `ruff` / `bandit` from the active environment discoverable.
_scripts = Path(sys.executable).parent
os.environ["PATH"] = f"{_scripts}{os.pathsep}{os.environ.get('PATH', '')}"


class _NoLiveGroq:
    def __init__(self, *args, **kwargs):
        raise RuntimeError("Live LLM calls are disabled in tests.")


@pytest.fixture(autouse=True)
def _block_live_llm(monkeypatch):
    import utils.groq_keys
    import utils.llm

    # A fresh key pool per test: no rested or rejected keys carry over.
    monkeypatch.setattr(utils.groq_keys, "_pool", None)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEYS", raising=False)
    monkeypatch.setattr(utils.llm, "Groq", _NoLiveGroq)


@pytest.fixture(autouse=True)
def upload_root(tmp_path, monkeypatch):
    """Redirect the repository store to an isolated temporary directory."""

    root = (tmp_path / "uploads").resolve()
    monkeypatch.setenv("CODELENS_UPLOAD_DIR", str(root))
    return root


class FakeLLM:
    """Records prompts and returns canned responses."""

    def __init__(self):
        self.calls = []
        self.response = "Fake LLM response."
        self.error = None

    def __call__(self, prompt, max_tokens=2048, *, system=None):
        # The system message is recorded with the prompt: both are sent.
        self.calls.append(f"{system}\n\n{prompt}" if system else prompt)
        if self.error:
            raise self.error
        return self.response


@pytest.fixture
def fake_llm(monkeypatch):
    fake = FakeLLM()

    import agents.chat_agent
    import agents.explain_agent
    import agents.finding_agent
    import agents.repo_agent

    monkeypatch.setattr(agents.repo_agent, "call_llm", fake)
    monkeypatch.setattr(agents.chat_agent, "call_llm", fake)
    monkeypatch.setattr(agents.explain_agent, "call_llm", fake)
    monkeypatch.setattr(agents.finding_agent, "call_llm", fake)
    return fake


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from backend.main import app

    # Like a real server: unhandled errors become 500 responses.
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
