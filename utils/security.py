
import re
from pathlib import Path


# -----------------------------------
# Sensitive files
# -----------------------------------

SENSITIVE_FILENAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "credentials.json",
    "secrets.json",
    "service-account.json",
    "id_rsa",
    "id_ed25519"
}


def is_sensitive_file(file_path):
    """Check whether a file should be excluded entirely."""

    path = Path(file_path)
    filename = path.name.lower()

    if filename in SENSITIVE_FILENAMES:
        return True

    if filename.startswith(".env"):
        return True

    return False


# -----------------------------------
# Secret detection patterns
# -----------------------------------

SECRET_PATTERNS = [

    # API keys and tokens
    (
        r'(?i)(api[_-]?key|access[_-]?token|auth[_-]?token|'
        r'client[_-]?secret)\s*[:=]\s*["\']?[^"\'\s,;]+',
        r'\1=[REDACTED]'
    ),

    # Passwords
    (
        r'(?i)(password|passwd|pwd)\s*[:=]\s*["\']?[^"\'\s,;]+',
        r'\1=[REDACTED]'
    ),

    # Common cloud credentials
    (
        r'(?i)(aws_secret_access_key|aws_access_key_id)\s*[:=]\s*'
        r'["\']?[^"\'\s,;]+',
        r'\1=[REDACTED]'
    ),

    # GitHub personal access tokens
    (
        r'gh[pousr]_[A-Za-z0-9_]{20,}',
        '[REDACTED_GITHUB_TOKEN]'
    ),

    # Google API keys
    (
        r'AIza[0-9A-Za-z\-_]{30,}',
        '[REDACTED_GOOGLE_API_KEY]'
    ),

    # Private key blocks
    (
        r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'
        r'.*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        '[REDACTED_PRIVATE_KEY]'
    ),

    # Bearer tokens
    (
        r'(?i)Bearer\s+[A-Za-z0-9._\-]+',
        'Bearer [REDACTED]'
    )
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
