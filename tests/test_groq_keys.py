"""The Groq key pool: rotation, rate-limit rests and rejected keys. Groq is always faked."""

import pytest

import utils.llm
from utils.groq_keys import KeyPool, configured_keys, retry_after_seconds


class _StatusError(Exception):
    def __init__(self, status, headers=None):
        super().__init__(f"status {status} gsk_secret_fragment")
        self.status_code = status
        self.response = type("Response", (), {"headers": headers or {}})()


def _reply(text):
    message = type("Message", (), {"content": text})()
    choice = type("Choice", (), {"message": message})()
    return type("Response", (), {"choices": [choice]})()


def _fake_groq(monkeypatch, behaviour):
    """behaviour(api_key) -> reply or raises; records which keys were used."""

    used = []

    class FakeGroq:
        def __init__(self, api_key):
            self.chat = type("Chat", (), {})()
            completions = type("Completions", (), {})()

            def create(**_kwargs):
                used.append(api_key)
                return behaviour(api_key)

            completions.create = create
            self.chat.completions = completions

    monkeypatch.setattr(utils.llm, "Groq", FakeGroq)
    return used


def test_keys_come_from_both_variables_without_duplicates(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEYS", "k1, k2\nk3;k1")
    monkeypatch.setenv("GROQ_API_KEY", "k2")
    assert configured_keys() == ("k1", "k2", "k3")


def test_round_robin_spreads_requests(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEYS", "k1,k2,k3")
    used = _fake_groq(monkeypatch, lambda _key: _reply("ok"))

    for _ in range(4):
        assert utils.llm.call_llm("hi") == "ok"

    assert used == ["k1", "k2", "k3", "k1"]


def test_rate_limited_key_hands_over_to_the_next(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEYS", "k1,k2")

    def behaviour(key):
        if key == "k1":
            raise _StatusError(429, {"retry-after": "30"})
        return _reply("from k2")

    used = _fake_groq(monkeypatch, behaviour)

    assert utils.llm.call_llm("hi") == "from k2"
    # k1 now rests: the next request goes straight to k2.
    assert utils.llm.call_llm("hi") == "from k2"
    assert used == ["k1", "k2", "k2"]
    assert utils.llm.get_provider()._pool.status()["resting"] == 1


def test_every_key_limited_gives_a_clean_message(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEYS", "k1,k2")
    _fake_groq(monkeypatch, lambda _key: (_ for _ in ()).throw(_StatusError(429)))

    with pytest.raises(utils.llm.AIServiceError) as raised:
        utils.llm.call_llm("hi")
    assert "per-minute limit" in str(raised.value)
    assert "gsk_" not in str(raised.value)

    # Both keys rest now: nothing is sent at all.
    with pytest.raises(utils.llm.AIServiceError, match="All 2 Groq key"):
        utils.llm.call_llm("hi")


def test_rejected_key_is_skipped_from_then_on(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEYS", "bad,good")

    def behaviour(key):
        if key == "bad":
            raise _StatusError(401)
        return _reply("ok")

    used = _fake_groq(monkeypatch, behaviour)
    for _ in range(3):
        utils.llm.call_llm("hi")
    assert used == ["bad", "good", "good", "good"]


def test_other_errors_are_not_retried_on_other_keys(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEYS", "k1,k2")
    used = _fake_groq(monkeypatch, lambda _key: (_ for _ in ()).throw(_StatusError(500)))

    with pytest.raises(utils.llm.AIServiceError, match="Groq returned an error"):
        utils.llm.call_llm("hi")
    assert used == ["k1"]


def test_rest_ends_after_the_cooldown():
    now = [0.0]
    pool = KeyPool(("k1",), clock=lambda: now[0])
    pool.rest(0, 10)
    assert pool.acquire() is None
    now[0] = 11
    assert pool.acquire() == 0


@pytest.mark.parametrize("value, seconds", [("12", 12), ("7.5s", 7.5), ("1m30s", 90), ("250ms", 0.25)])
def test_retry_after_formats(value, seconds):
    assert retry_after_seconds(_StatusError(429, {"retry-after": value})) == pytest.approx(seconds)


def test_consent_reports_the_key_count(client, monkeypatch):
    from tests.helpers import upload_repo

    monkeypatch.setenv("GROQ_API_KEYS", "k1,k2,k3")
    repo = upload_repo(client)
    assert client.get(f"/api/repositories/{repo['id']}/ai-consent").json()["keys"] == 3
