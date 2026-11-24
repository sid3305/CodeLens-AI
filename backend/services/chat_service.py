"""
Repository chat: finding the code a question is about, and keeping the
conversation.

Retrieval is lexical and local (no embeddings, nothing sent anywhere): the
question's words are matched against file paths and file contents, and the
best window of lines from the top files is sent as excerpts. Sensitive
files are never read. The conversation is stored in the repository's
workspace (chat.json) and deleted with it.
"""

import json
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from agents.chat_agent import Excerpt
from backend.services.fact_sheet import collect_facts, fact_sections
from backend.services.repository_service import list_repository_files
from utils.config import get_upload_dir
from utils.parser import read_file_content
from utils.security import is_sensitive_file, resolve_within

MAX_EXCERPTS = 3
WINDOW_LINES = 40
MAX_SCAN_FILES = 3000
MAX_SCAN_BYTES = 256 * 1024
FACT_SECTIONS = 4  # overview, dependencies, structure, findings (no README or signatures)
CHAT_FILE = "chat.json"
MAX_MESSAGES = 200

STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was",
    "one", "our", "out", "has", "have", "how", "its", "may", "new", "now", "see", "two", "way",
    "who", "did", "get", "let", "put", "say", "she", "too", "use", "what", "when", "where", "which",
    "why", "with", "this", "that", "from", "they", "them", "then", "than", "there", "their", "will",
    "would", "could", "should", "about", "into", "does", "doing", "done", "each", "file", "files",
    "code", "repo", "repository", "project", "explain", "tell", "show", "give", "list", "find",
    "work", "works", "working", "make", "made", "used", "using", "also", "just", "like", "some",
    "more", "most", "only", "other", "over", "such", "very", "want", "need", "please", "function",
    "functions", "method", "class", "line", "lines", "part", "here", "been", "being", "were",
    "your", "yours",
}

_lock = threading.Lock()


# --- Retrieval ----------------------------------------------------------------

def question_terms(question: str) -> list[str]:
    """Distinct lowercase search terms, including the parts of camelCase and snake_case names."""

    terms: list[str] = []
    for word in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", question):
        pieces = [word] + re.split(r"_+|(?<=[a-z0-9])(?=[A-Z])", word)
        for piece in pieces:
            piece = piece.lower().strip("_")
            if len(piece) >= 3 and piece not in STOPWORDS and piece not in terms:
                terms.append(piece)
    return terms[:20]


def _mentioned_paths(question: str, paths: list[str]) -> set[str]:
    lowered = question.lower()
    mentioned = set()
    for path in paths:
        name = PurePosixPath(path).name.lower()
        if path.lower() in lowered or (len(name) > 4 and "." in name and name in lowered):
            mentioned.add(path)
    return mentioned


def _best_window(lines: list[str], terms: list[str]) -> tuple[int, int]:
    """1-based (start, end) of the WINDOW_LINES lines with the most term hits."""

    if len(lines) <= WINDOW_LINES:
        return 1, max(len(lines), 1)
    hits = [sum(term in line.lower() for term in terms) for line in lines]
    best_start, best = 0, sum(hits[:WINDOW_LINES])
    current = best
    for start in range(1, len(lines) - WINDOW_LINES + 1):
        current += hits[start + WINDOW_LINES - 1] - hits[start - 1]
        if current > best:
            best_start, best = start, current
    # Start a little before the first hit so the context reads well.
    if best:
        first_hit = next(i for i in range(best_start, best_start + WINDOW_LINES) if hits[i])
        best_start = max(0, min(first_hit - 5, len(lines) - WINDOW_LINES))
    return best_start + 1, best_start + WINDOW_LINES


def find_excerpts(repository: dict, question: str) -> list[Excerpt]:
    """Up to MAX_EXCERPTS code windows most related to the question."""

    terms = question_terms(question)
    paths = [item["path"] for item in list_repository_files(repository["id"])["files"]][:MAX_SCAN_FILES]
    mentioned = _mentioned_paths(question, paths)
    if not terms and not mentioned:
        return []

    scored: list[tuple[float, str, list[str]]] = []
    for relative in paths:
        if is_sensitive_file(relative):
            continue
        try:
            path = resolve_within(repository["path"], relative)
        except ValueError:
            continue
        if not path.is_file() or path.stat().st_size > MAX_SCAN_BYTES:
            continue
        lowered_path = relative.lower()
        stem = PurePosixPath(lowered_path).stem
        score = 50.0 if relative in mentioned else 0.0
        for term in terms:
            if term == stem:
                score += 10
            elif term in lowered_path:
                score += 5
        content = read_file_content(str(path))
        if content.startswith("Error reading file:"):
            continue
        lowered = content.lower()
        for term in terms:
            count = lowered.count(term)
            if count:
                score += 1 + min(count, 8) * 0.5
        if score > 0:
            scored.append((score, relative, content.splitlines()))

    scored.sort(key=lambda item: (-item[0], item[1]))
    excerpts = []
    for _, relative, lines in scored[:MAX_EXCERPTS]:
        start, end = _best_window(lines, terms)
        excerpts.append(Excerpt(relative, start, end, "\n".join(lines[start - 1:end])))
    return excerpts


def chat_facts(repository: dict) -> list[str]:
    return fact_sections(collect_facts(repository["id"], repository), repository)[:FACT_SECTIONS]


# --- Conversation store -------------------------------------------------------

def _path(repo_id: str) -> Path:
    root = get_upload_dir()
    workspace = (root / repo_id).resolve()
    workspace.relative_to(root)  # never outside the store
    return workspace / CHAT_FILE


def load_history(repo_id: str) -> list[dict]:
    with _lock:
        try:
            data = json.loads(_path(repo_id).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
    return data if isinstance(data, list) else []


def new_message(role: str, content: str, **extra) -> dict:
    return {
        "id": uuid.uuid4().hex,
        "role": role,
        "content": content,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **extra,
    }


def append_messages(repo_id: str, messages: list[dict]) -> None:
    path = _path(repo_id)
    with _lock:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                data = []
        except (OSError, ValueError):
            data = []
        data = (data + messages)[-MAX_MESSAGES:]
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data), encoding="utf-8")
        temporary.replace(path)


def clear_history(repo_id: str) -> None:
    with _lock:
        _path(repo_id).unlink(missing_ok=True)
