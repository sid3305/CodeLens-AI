
import re
from pathlib import Path

# -----------------------------------
# Sensitive files
# -----------------------------------

SENSITIVE_FILENAMES = {
    "credentials.json",
    "service-account.json",
    ".npmrc",
    ".pypirc",
    ".netrc",
    ".git-credentials",
    ".htpasswd",
    ".pgpass",
}

# Key and certificate containers.
SENSITIVE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"}

# SSH private and public keys.
SSH_KEY_NAMES = {"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "id_ecdsa_sk", "id_ed25519_sk"}


def is_sensitive_file(file_path):
    """
    Whether a file must never be listed, previewed or sent to an LLM:
    dotenv files, package-manager and git credentials, SSH keys (id_*),
    key/certificate files, secrets.* and AWS credentials.
    """

    path = Path(str(file_path).replace("\\", "/"))
    filename = path.name.lower()
    parts = [part.lower() for part in path.parts]

    if filename in SENSITIVE_FILENAMES or filename.startswith(".env"):
        return True
    if filename.split(".")[0] in SSH_KEY_NAMES:
        return True
    if path.suffix.lower() in SENSITIVE_SUFFIXES:
        return True
    # secrets.json, secrets.yaml, secrets.toml, secrets.py ...
    if filename.startswith("secrets."):
        return True
    # ~/.aws/credentials and ~/.aws/config.
    return len(parts) >= 2 and parts[-2] == ".aws" and filename in {"credentials", "config"}


# -----------------------------------
# Secret detection patterns
# -----------------------------------

SECRET_PATTERNS = [

    # Private keys of any kind (RSA, EC, OPENSSH, ENCRYPTED, DSA, PGP blocks).
    (
        r"-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----.*?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----",
        "[REDACTED_PRIVATE_KEY]",
    ),

    # Credentials in URLs: scheme://user:password@host
    (r"(?i)\b([a-z][a-z0-9+.\-]*://[^\s:/@]+):[^\s@/]+@", r"\1:[REDACTED]@"),

    # Provider tokens (their prefixes are distinctive enough to match alone).
    (r"\bAKIA[0-9A-Z]{16}\b", "[REDACTED_AWS_KEY_ID]"),
    (r"\bxox[abposr]-[A-Za-z0-9-]{10,}", "[REDACTED_SLACK_TOKEN]"),
    (r"\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}", "[REDACTED_STRIPE_KEY]"),
    (r"\bgsk_[A-Za-z0-9]{20,}", "[REDACTED_GROQ_KEY]"),
    (r"\bsk-ant-[A-Za-z0-9_\-]{20,}", "[REDACTED_ANTHROPIC_KEY]"),
    (r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_\-]{20,}", "[REDACTED_OPENAI_KEY]"),
    (r"\bgh[pousr]_[A-Za-z0-9_]{20,}", "[REDACTED_GITHUB_TOKEN]"),
    (r"\bgithub_pat_[A-Za-z0-9_]{20,}", "[REDACTED_GITHUB_TOKEN]"),
    (r"\bAIza[0-9A-Za-z\-_]{30,}", "[REDACTED_GOOGLE_API_KEY]"),
    (r"\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}", "[REDACTED_JWT]"),

    # Bearer tokens
    (r"(?i)Bearer\s+[A-Za-z0-9._\-]+", "Bearer [REDACTED]"),

    # Values assigned to secret-looking names, in code, config and JSON:
    #   api_key = "...", "apiKey": "...", SECRET_KEY = ..., token: ..., password=...
    (
        (
            r"(?i)([A-Za-z0-9_.\-]*?"
            r"(?:api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret"
            r"|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|secret"
            r"|password|passwd|pwd)"
            r"[\"']?\s*[:=]\s*)([\"']?)[^\"'\s,;]{4,}\2"
        ),
        r"\1\2[REDACTED]\2",
    ),
]


# -----------------------------------
# Redact secrets
# -----------------------------------

def redact_secrets(content):
    """
    Detect and redact common secret patterns
    from source code before sending it to an LLM.
    """

    if not content:
        return content

    sanitized_content = content

    for pattern, replacement in SECRET_PATTERNS:

        sanitized_content = re.sub(
            pattern,
            replacement,
            sanitized_content,
            flags=re.DOTALL if "PRIVATE KEY" in pattern else 0
        )

    return sanitized_content


# -----------------------------------
# Safe content preparation
# -----------------------------------

def prepare_content_for_llm(file_path, content):
    """
    Exclude sensitive files and redact detected secrets.
    Returns None when the entire file must be excluded.
    """

    if is_sensitive_file(file_path):
        return None

    return redact_secrets(content)


# -----------------------------------
# Links and path containment (SEC-07)
# -----------------------------------

_DRIVE = re.compile(r"^[A-Za-z]:")


def is_link(path):
    """True for symbolic links and Windows junctions (never followed)."""

    path = Path(path)
    if path.is_symlink():
        return True
    is_junction = getattr(path, "is_junction", None)  # Python 3.12+
    return bool(is_junction and is_junction())


def resolve_within(root, relative):
    """
    Resolve a repository-relative path, refusing anything that could leave
    the repository: absolute paths, drive letters, '..', any symlink or
    junction along the way, and results that resolve outside ``root``.
    """

    root = Path(root).resolve()
    text = str(relative).replace("\\", "/")
    parts = [part for part in text.split("/") if part not in ("", ".")]

    if text.startswith("/") or _DRIVE.match(text) or ".." in parts:
        raise ValueError("Invalid file path.")

    current = root
    for part in parts:
        current = current / part
        if is_link(current):
            raise ValueError("Symbolic links are not followed.")

    resolved = current.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError("File is outside the repository.")
    return resolved
