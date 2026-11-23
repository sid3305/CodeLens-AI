"""Secret redaction and sensitive-file detection (utils/security.py)."""

import pytest

from utils.security import is_sensitive_file, prepare_content_for_llm, redact_secrets


@pytest.mark.parametrize(
    ("source", "secret"),
    [
        ('API_KEY = "sk_live_abcdef123456"', "sk_live_abcdef123456"),
        ("api-key: abcdef123456", "abcdef123456"),
        ("access_token=tok_987654321", "tok_987654321"),
        ("client_secret = 's3cr3tvalue'", "s3cr3tvalue"),
        ('password = "hunter2"', "hunter2"),
        ("PWD=topsecret", "topsecret"),
        ("aws_secret_access_key = AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"),
        ("token ghp_" + "a" * 36, "ghp_" + "a" * 36),
        ("key AIza" + "b" * 35, "AIza" + "b" * 35),
        ("Authorization: Bearer abc.def.ghi", "abc.def.ghi"),
    ],
)
def test_known_secret_patterns_are_redacted(source, secret):
    redacted = redact_secrets(source)

    assert secret not in redacted
    assert "REDACTED" in redacted


def test_private_key_blocks_are_redacted_across_lines():
    key = (
        "-----BEGIN RSA PRIVATE KEY-----\n"
        "MIIEowIBAAKCAQEAsecretmaterial\n"
        "-----END RSA PRIVATE KEY-----"
    )

    redacted = redact_secrets(f"before\n{key}\nafter")

    assert "secretmaterial" not in redacted
    assert "[REDACTED_PRIVATE_KEY]" in redacted
    assert redacted.startswith("before") and redacted.endswith("after")


def test_ordinary_code_is_unchanged():
    code = "def add(a, b):\n    return a + b\n"
    assert redact_secrets(code) == code


@pytest.mark.parametrize("value", ["", None])
def test_empty_content_is_returned_as_is(value):
    assert redact_secrets(value) == value


@pytest.mark.parametrize(
    "name",
    [".env", ".env.local", ".ENV.production", "id_rsa", "credentials.json", "secrets.json"],
)
def test_sensitive_files_are_detected(name):
    assert is_sensitive_file(f"some/dir/{name}")


@pytest.mark.parametrize("name", ["main.py", "environment.py", "README.md"])
def test_regular_files_are_not_sensitive(name):
    assert not is_sensitive_file(name)


def test_prepare_content_excludes_sensitive_files_and_redacts_others():
    assert prepare_content_for_llm(".env", "GROQ_API_KEY=x") is None
    assert "hunter2" not in prepare_content_for_llm("app.py", "password='hunter2'")
