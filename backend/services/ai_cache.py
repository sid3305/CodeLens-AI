"""
Every AI answer is kept, so asking the same thing again costs no tokens.

Keys are sha256(repository + content fingerprint + task + PROMPT_VERSION +
provider + model + token budget): changing any of them asks again. A hit
never calls the provider; regenerating is an explicit request (force).
The cache lives in the repository's workspace and is deleted with it.
"""

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from prompts.prompts import PROMPT_VERSION
from utils.config import get_upload_dir
from utils.llm import provider_info
from utils.token_budget import max_input_tokens, max_output_tokens

_lock = threading.Lock()
CACHE_FILE = "ai_cache.json"
MAX_ENTRIES = 500


def fingerprint(*parts: str | None) -> str:
    return hashlib.sha256("\x1f".join(part or "" for part in parts).encode("utf-8")).hexdigest()


def make_key(repo_id: str, task: str, content_fingerprint: str) -> str:
    info = provider_info()
    return fingerprint(
        repo_id, content_fingerprint, task, PROMPT_VERSION, str(info["provider"]), str(info["model"]),
        str(max_input_tokens()), str(max_output_tokens()),
    )


def _path(repo_id: str) -> Path:
    root = get_upload_dir()
    workspace = (root / repo_id).resolve()
    workspace.relative_to(root)  # never outside the store
    return workspace / CACHE_FILE


def _load(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def get(repo_id: str, key: str) -> dict | None:
    with _lock:
        return _load(_path(repo_id)).get(key)


def put(repo_id: str, key: str, text: str) -> dict:
    entry = {"text": text, "generated_at": datetime.now(timezone.utc).isoformat()}
    path = _path(repo_id)
    with _lock:
        data = _load(path)
        data[key] = entry
        # Keep the newest entries only.
        if len(data) > MAX_ENTRIES:
            for old in sorted(data, key=lambda k: data[k].get("generated_at", ""))[: len(data) - MAX_ENTRIES]:
                del data[old]
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data), encoding="utf-8")
        temporary.replace(path)
    return entry


def cached_answer(repo_id: str, task: str, content_fingerprint: str, ask, *, force: bool = False) -> tuple[str, bool]:
    """(answer, came from cache). `ask` calls the provider and is used only on a miss or force."""

    key = make_key(repo_id, task, content_fingerprint)
    if not force:
        hit = get(repo_id, key)
        if hit is not None and (hit.get("text") or "").strip():
            return hit["text"], True
    text = ask()
    put(repo_id, key, text)
    return text, False
