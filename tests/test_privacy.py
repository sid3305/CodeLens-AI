"""
B6: per-repository AI consent, the provider layer, sensitive files,
secret redaction and clean AI errors. The provider is always faked.
"""

import json
import urllib.error

import pytest

import utils.llm
from tests.helpers import allow_ai, upload_repo
from utils.security import is_sensitive_file, redact_secrets

# --- Consent -------------------------------------------------------------------


def _summary(client, repo):
    return client.post(f"/api/repositories/{repo['id']}/summary")


def _explain(client, repo, path="app/main.py"):
    return client.post(f"/api/repositories/{repo['id']}/files/explain", json={"file_path": path})


def test_ai_is_off_by_default_and_names_the_provider(client):
    repo = upload_repo(client)

    consent = client.get(f"/api/repositories/{repo['id']}/ai-consent").json()

    assert consent["enabled"] is False
    assert consent["provider"] == "Groq"
    assert consent["model"] == utils.llm.MODEL_NAME
    # No key in tests: the UI can say AI is not set up.
    assert consent["configured"] is False


def test_no_code_is_sent_without_consent(client, fake_llm):
    repo = upload_repo(client)

    for response in (_summary(client, repo), _explain(client, repo)):
        assert response.status_code == 403
        assert "Groq" in response.json()["detail"]
    assert fake_llm.calls == []


def test_consent_enables_and_revokes_ai(client, fake_llm):
    repo = upload_repo(client)

    assert allow_ai(client, repo)["enabled"] is True
    assert _summary(client, repo).status_code == 200
    assert _explain(client, repo).status_code == 200
    assert len(fake_llm.calls) == 2

    client.put(f"/api/repositories/{repo['id']}/ai-consent", json={"enabled": False})
    assert _explain(client, repo).status_code == 403
    assert len(fake_llm.calls) == 2


def test_consent_is_per_repository(client, fake_llm):
    first = upload_repo(client)
    second = upload_repo(client)
    allow_ai(client, first)

    assert _explain(client, first).status_code == 200
    assert _explain(client, second).status_code == 403
    assert client.get(f"/api/repositories/{second['id']}/ai-consent").json()["enabled"] is False


def test_consent_for_unknown_repository_is_404(client):
    url = "/api/repositories/0123456789abcdef0123456789abcdef/ai-consent"
    assert client.get(url).status_code == 404
    assert client.put(url, json={"enabled": True}).status_code == 404


def test_consent_is_shown_on_the_repository(client):
    repo = upload_repo(client)
    allow_ai(client, repo)

    listed = next(r for r in client.get("/api/repositories").json() if r["id"] == repo["id"])
    assert listed["ai_consent"] is True


# --- Sensitive files ---------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        ".env", ".env.test", "config/.env.production",
        ".npmrc", ".pypirc", ".netrc", ".git-credentials", ".htpasswd",
        "certs/server.pem", "tls/private.key", "keys/cert.p12", "keys/store.pfx",
        "id_rsa", "home/.ssh/id_ecdsa", "id_ed25519.pub", "id_dsa",
        "secrets.json", "secrets.yaml", "config/secrets.toml", "secrets.py",
        ".aws/credentials", "deploy/.aws/credentials",
        "credentials.json", "service-account.json",
    ],
)
def test_sensitive_files_are_recognised(path):
    assert is_sensitive_file(path)


@pytest.mark.parametrize(
    "path",
    ["app/main.py", "keys.py", "monkey.js", "secret_santa.py", "docs/credentials.md",
     "key_manager.ts", "README.md", "identity.py", "aws/credentials_helper.py"],
)
def test_ordinary_files_are_not_sensitive(path):
    assert not is_sensitive_file(path)


def test_sensitive_files_are_never_explained(client, fake_llm):
    repo = upload_repo(client, {"app/main.py": "x = 1\n", "secrets.py": "TOKEN = 'abc'\n"})
    allow_ai(client, repo)

    response = _explain(client, repo, "secrets.py")

    assert response.status_code in (400, 403, 404)
    assert fake_llm.calls == []


def test_summary_never_includes_sensitive_files(client, fake_llm):
    repo = upload_repo(client, {
        "app/main.py": "def main():\n    return 1\n",
        "secrets.py": "MARKER_IN_SECRETS_FILE = 1\n",
        "config/settings.py": "OK = True\n",
    })
    allow_ai(client, repo)

    assert _summary(client, repo).status_code == 200
    (prompt,) = fake_llm.calls
    assert "MARKER_IN_SECRETS_FILE" not in prompt
    assert "secrets.py" not in prompt
    assert "app/main.py" in prompt


def test_sensitive_files_are_not_listed(client):
    repo = upload_repo(client, {"app/main.py": "x = 1\n", "secrets.py": "y = 2\n"})

    paths = [f["path"] for f in client.get(f"/api/repositories/{repo['id']}/files").json()["files"]]
    assert "secrets.py" not in paths


# --- Redaction -----------------------------------------------------------------------

SECRETS = {
    "aws key id": "AKIAIOSFODNN7EXAMPLE",
    "aws secret": "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "slack": "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx",
    "stripe": "sk_live_51HxAbCdEfGhIjKlMnOpQrStUv",
    "groq": "gsk_" + "a1B2c3D4e5F6g7H8i9J0" * 2,
    "openai": "sk-proj-" + "A1b2C3d4E5f6G7h8I9j0" * 2,
    "anthropic": "sk-ant-api03-" + "A1b2C3d4E5f6G7h8I9j0" * 2,
    "github": "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2",
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "url credentials": "postgres://admin:S3cretPassw0rd@db.internal:5432/app",
    "json api key": '{"apiKey": "live-1234567890abcdef"}',
    "secret assignment": 'SECRET_KEY = "django-insecure-abcdefghijklmnop"',
    "token assignment": "token: abcdef1234567890abcdef",
    "private key": "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIBvTBXBgkqhkiG9w0BBQ0wSjApBgkq\n-----END ENCRYPTED PRIVATE KEY-----",
    "pgp key": "-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF0\n-----END PGP PRIVATE KEY BLOCK-----",
}

SECRET_VALUES = {
    "aws key id": "AKIAIOSFODNN7EXAMPLE",
    "aws secret": "wJalrXUtnFEMI",
    "slack": "xoxb-123456789012",
    "stripe": "sk_live_51HxAbCd",
    "groq": "gsk_a1B2c3D4",
    "openai": "sk-proj-A1b2",
    "anthropic": "sk-ant-api03-A1b2",
    "github": "ghp_A1b2C3d4",
    "jwt": "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    "url credentials": "S3cretPassw0rd",
    "json api key": "live-1234567890abcdef",
    "secret assignment": "django-insecure",
    "token assignment": "abcdef1234567890abcdef",
    "private key": "MIIBvTBXBgkqhkiG9w0BBQ0wSjApBgkq",
    "pgp key": "lQOYBF0",
}


@pytest.mark.parametrize("kind", sorted(SECRETS))
def test_secrets_are_redacted(kind):
    redacted = redact_secrets(f"before\n{SECRETS[kind]}\nafter")

    assert SECRET_VALUES[kind] not in redacted
    assert "before" in redacted and "after" in redacted
    assert "REDACTED" in redacted


def test_ordinary_code_is_left_alone():
    code = "def tokenize(text):\n    keys = sorted(mapping)\n    return [t for t in text.split()]\n"
    assert redact_secrets(code) == code


def test_everything_sent_to_the_provider_is_redacted(monkeypatch):
    sent = []

    class Recorder:
        name = "Recorder"
        model = "m"
        configured = True

        def complete(self, messages, max_tokens):
            sent.extend(messages)
            return "ok"

    monkeypatch.setattr(utils.llm, "get_provider", lambda: Recorder())

    utils.llm.call_llm(f"code\n{SECRETS['groq']}\n", system=f"system {SECRETS['github']}")

    text = json.dumps(sent)
    assert SECRET_VALUES["groq"] not in text
    assert SECRET_VALUES["github"] not in text


# --- Providers --------------------------------------------------------------------------


def test_groq_is_the_default_provider():
    assert utils.llm.get_provider().name == "Groq"


def test_ollama_can_be_selected(monkeypatch):
    monkeypatch.setenv("CODELENS_LLM_PROVIDER", "ollama")
    monkeypatch.setenv("CODELENS_OLLAMA_MODEL", "llama3.1:8b")

    provider = utils.llm.get_provider()

    assert provider.name == "Ollama"
    assert provider.model == "llama3.1:8b"
    assert provider.configured is True


def test_unknown_provider_is_a_clear_configuration_error(monkeypatch):
    monkeypatch.setenv("CODELENS_LLM_PROVIDER", "mystery")

    with pytest.raises(utils.llm.AINotConfiguredError, match="mystery"):
        utils.llm.get_provider()


def test_ollama_sends_a_chat_request_to_the_local_server(monkeypatch):
    monkeypatch.setenv("CODELENS_LLM_PROVIDER", "ollama")
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"message": {"content": "local answer"}}).encode()

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data)
        return Response()

    monkeypatch.setattr(utils.llm.urllib.request, "urlopen", fake_urlopen)

    assert utils.llm.call_llm("hello", max_tokens=77) == "local answer"
    assert captured["url"] == "http://localhost:11434/api/chat"
    assert captured["body"]["stream"] is False
    assert captured["body"]["options"]["num_predict"] == 77
    assert captured["body"]["messages"][-1] == {"role": "user", "content": "hello"}


def test_ollama_unreachable_is_a_clean_error(monkeypatch):
    monkeypatch.setenv("CODELENS_LLM_PROVIDER", "ollama")

    def refuse(request, timeout):
        raise urllib.error.URLError(ConnectionRefusedError(10061, "refused"))

    monkeypatch.setattr(utils.llm.urllib.request, "urlopen", refuse)

    with pytest.raises(utils.llm.AIServiceError) as error:
        utils.llm.call_llm("hello")
    assert str(error.value) == "Could not reach Ollama. Check that it is running and try again."


# --- Clean errors ---------------------------------------------------------------------

RAW_AUTH = (
    "Error code: 401 - {'error': {'message': 'Invalid API Key gsk_live1234567890abcdef', "
    "'type': 'invalid_request_error', 'code': 'invalid_api_key'}}"
)


class _ProviderFailure(Exception):
    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        (_ProviderFailure(RAW_AUTH, 401), "Groq rejected the API key. Check GROQ_API_KEY in .env."),
        (_ProviderFailure("Error code: 429 - {'error': 'slow down'}", 429),
         "Groq's per-minute limit was reached. Wait a minute, or lower CODELENS_LLM_MAX_INPUT_TOKENS (now 3000)."),
        (ConnectionError("connection to api.groq.com failed"), "Could not reach Groq. Check your connection and try again."),
        (_ProviderFailure("Error code: 500 - {'error': 'internal'}", 500), "Groq returned an error. Try again later."),
        (_ProviderFailure("Error code: 413 - {'error': 'Request too large'}", 413),
         ("Groq refused the request as too large for your plan's per-minute token limit. "
          "Lower CODELENS_LLM_MAX_INPUT_TOKENS (now 3000) or select less code.")),
        (ValueError(r"weird failure at C:\Users\someone\secret\path"), "Groq returned an error. Try again later."),
    ],
)
def test_provider_failures_become_clean_messages(monkeypatch, failure, expected):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test_key_1234567890")

    class FailingGroq:
        def __init__(self, api_key):
            self.chat = type("Chat", (), {})()
            self.chat.completions = type("Completions", (), {"create": staticmethod(self.fail)})()

        @staticmethod
        def fail(**kwargs):
            raise failure

    monkeypatch.setattr(utils.llm, "Groq", FailingGroq)

    with pytest.raises(utils.llm.AIServiceError) as error:
        utils.llm.call_llm("prompt")
    assert str(error.value) == expected


def test_routes_return_only_the_clean_message(client, monkeypatch, upload_root):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test_key_1234567890")

    class FailingGroq:
        def __init__(self, api_key):
            self.chat = type("Chat", (), {})()
            self.chat.completions = type("Completions", (), {"create": staticmethod(self.fail)})()

        @staticmethod
        def fail(**kwargs):
            raise _ProviderFailure(f"{RAW_AUTH} at {upload_root}", 401)

    monkeypatch.setattr(utils.llm, "Groq", FailingGroq)
    repo = upload_repo(client)
    allow_ai(client, repo)

    for response in (_summary(client, repo), _explain(client, repo)):
        assert response.status_code == 502
        detail = response.json()["detail"]
        assert detail == "Groq rejected the API key. Check GROQ_API_KEY in .env."
        for leak in ("gsk_", "{", "invalid_request_error", str(upload_root)):
            assert leak not in detail


def test_missing_key_is_a_clear_503(client):
    repo = upload_repo(client)
    allow_ai(client, repo)

    response = _explain(client, repo)

    assert response.status_code == 503
    assert response.json()["detail"] == "AI is not set up: add GROQ_API_KEY to .env and restart the backend."


# --- Explain selection (C5) -------------------------------------------------------------


def test_explain_selection_sends_only_the_selected_lines(client, fake_llm):
    lines = "\n".join(f"value_{n} = {n}" for n in range(1, 41)) + "\n"
    repo = upload_repo(client, {"app/main.py": lines})
    allow_ai(client, repo)

    response = client.post(
        f"/api/repositories/{repo['id']}/files/explain",
        json={"file_path": "app/main.py", "start_line": 10, "end_line": 12},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["start_line"] == 10 and body["end_line"] == 12
    (prompt,) = fake_llm.calls
    assert "value_10 = 10" in prompt and "value_12 = 12" in prompt
    assert "value_9 = 9" not in prompt and "value_13 = 13" not in prompt


@pytest.mark.parametrize(
    ("start", "end"),
    [(0, 3), (5, 2), (1, 999), (1, 401)],
)
def test_explain_selection_rejects_bad_ranges(client, fake_llm, start, end):
    repo = upload_repo(client, {"app/main.py": "\n".join(f"x{n} = {n}" for n in range(1, 501)) + "\n"})
    allow_ai(client, repo)

    response = client.post(
        f"/api/repositories/{repo['id']}/files/explain",
        json={"file_path": "app/main.py", "start_line": start, "end_line": end},
    )

    assert response.status_code in (400, 422)
    assert fake_llm.calls == []


def test_over_budget_requests_are_refused_before_sending(monkeypatch):
    sent = []
    monkeypatch.setattr(utils.llm, "get_provider", lambda: type("P", (), {"complete": lambda self, m, t: sent.append(t) or "ok"})())
    monkeypatch.setenv("CODELENS_LLM_MAX_INPUT_TOKENS", "100")

    with pytest.raises(ValueError, match="over the limit of 100"):
        utils.llm.call_llm("x" * 401)
    assert utils.llm.call_llm("x" * 400, max_tokens=5000) == "ok"
    assert sent == [700]


def test_estimate_counts_the_real_payload_and_sends_nothing(client, fake_llm):
    repo = upload_repo(client, {"app/main.py": "x = 1\n" * 50})

    body = client.post(f"/api/repositories/{repo['id']}/ai/estimate",
                       json={"task": "explain", "file_path": "app/main.py", "start_line": 1, "end_line": 10}).json()

    assert 0 < body["input_tokens"] < body["max_input_tokens"] == 3000
    assert body["output_tokens"] == 300 and body["within_budget"] is True
    assert fake_llm.calls == []
