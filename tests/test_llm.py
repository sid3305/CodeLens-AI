"""LLM client wrapper and agents. The provider is always faked."""

import pytest

import utils.llm
from agents.explain_agent import run_explain_agent
from agents.repo_agent import run_repo_agent


class _FakeCompletions:
    def __init__(self, behaviour):
        self.behaviour = behaviour
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return self.behaviour(kwargs)


class _FakeGroq:
    last = None

    def __init__(self, behaviour, api_key):
        self.api_key = api_key
        self.chat = type("Chat", (), {})()
        self.chat.completions = _FakeCompletions(behaviour)
        _FakeGroq.last = self


def _install(monkeypatch, behaviour):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setattr(
        utils.llm, "Groq", lambda api_key: _FakeGroq(behaviour, api_key)
    )


def _reply(text):
    message = type("Message", (), {"content": text})()
    choice = type("Choice", (), {"message": message})()
    return type("Response", (), {"choices": [choice]})()


def test_missing_key_is_reported():
    with pytest.raises(utils.llm.AINotConfiguredError, match="GROQ_API_KEY"):
        utils.llm.call_llm("hi")


def test_successful_call(monkeypatch):
    _install(monkeypatch, lambda _kwargs: _reply("hello"))

    assert utils.llm.call_llm("prompt", max_tokens=55) == "hello"

    sent = _FakeGroq.last.chat.completions.kwargs
    assert _FakeGroq.last.api_key == "test-key"
    assert sent["model"] == utils.llm.MODEL_NAME
    # The default model reasons, so it gets the full output budget.
    assert sent["max_tokens"] == 700
    assert sent["messages"] == [{"role": "user", "content": "prompt"}]


def test_provider_errors_are_wrapped(monkeypatch):
    def fail(_kwargs):
        raise ConnectionError("network down")

    _install(monkeypatch, fail)

    # B6: a clean message, not the provider's own text.
    with pytest.raises(utils.llm.AIServiceError, match="^Could not reach Groq"):
        utils.llm.call_llm("prompt")


def test_repo_agent_drops_low_priority_sections_and_redacts(fake_llm):
    sections = ["Repository: demo\npassword = 'hunter2'", "README (start):\n" + "x" * 40_000]

    result = run_repo_agent(sections)

    (prompt,) = fake_llm.calls
    assert "hunter2" not in prompt and "Repository: demo" in prompt
    assert len(prompt) <= 3000 * 4
    assert "Only a portion" in result


@pytest.mark.parametrize("content", ["", "   \n"])
def test_agents_reject_empty_content(fake_llm, content):
    with pytest.raises(ValueError):
        run_repo_agent(content)
    with pytest.raises(ValueError):
        run_explain_agent(content, "a.py")
    assert fake_llm.calls == []


def test_explain_agent_refuses_sensitive_files(fake_llm):
    with pytest.raises(ValueError, match="sensitive"):
        run_explain_agent("KEY=1", ".env")
    assert fake_llm.calls == []
