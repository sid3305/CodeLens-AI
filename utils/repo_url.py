"""
Repository link parsing (X1).

Accepts the links people actually paste (with or without scheme, www.,
.git, trailing slash, query or fragment; /tree/<ref>[/path], /blob/<ref>/path,
/commit/<sha>; http upgraded to https; the `owner/repo` shorthand) and
rejects everything else with a message that says what was wrong and shows
an accepted example.

Supported hosts live in ``HOSTS``. Adding GitLab or Bitbucket means adding
an entry (with its own name rules and path layout), not rewriting the parser.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import unquote, urlsplit

MAX_URL_LENGTH = 2048
EXAMPLE = "https://github.com/owner/repository"

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_SHA = re.compile(r"[0-9a-fA-F]{40}")
_HEX = re.compile(r"[0-9a-fA-F]{4,39}")
_REF_SEGMENT = re.compile(r"[A-Za-z0-9._-]+")
_PATH_SEGMENT_FORBIDDEN = re.compile(r"[\x00-\x1f\x7f\\:*?\"<>|]")
_MAX_REF_SEGMENTS = 3


@dataclass(frozen=True)
class GitHost:
    """A supported code host and its naming rules."""

    name: str
    hostname: str
    owner_pattern: re.Pattern
    repo_pattern: re.Pattern
    aliases: frozenset = field(default_factory=frozenset)

    def clone_url(self, owner: str, repo: str) -> str:
        return f"https://{self.hostname}/{owner}/{repo}.git"

    def web_url(self, owner: str, repo: str) -> str:
        return f"https://{self.hostname}/{owner}/{repo}"


HOSTS: dict[str, GitHost] = {
    "github.com": GitHost(
        name="GitHub",
        hostname="github.com",
        # GitHub: alphanumerics and single hyphens, no leading hyphen, <= 39.
        owner_pattern=re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})"),
        repo_pattern=re.compile(r"[A-Za-z0-9._-]{1,100}"),
        aliases=frozenset({"www.github.com"}),
    ),
}

_HOST_BY_NAME = {alias: host for host in HOSTS.values() for alias in {host.hostname, *host.aliases}}
_SUPPORTED_NAMES = " or ".join(sorted(host.name for host in HOSTS.values()))


@dataclass(frozen=True)
class RepositoryURL:
    host: str
    owner: str
    repo: str
    ref: str | None = None
    ref_kind: str | None = None  # "branch" (branch or tag) | "commit" | None
    focus_path: str | None = None
    # (ref, focus_path) pairs to try in order when a branch name may contain '/'.
    ref_candidates: tuple[tuple[str, str | None], ...] = ()

    @property
    def clone_url(self) -> str:
        return HOSTS[self.host].clone_url(self.owner, self.repo)

    @property
    def url(self) -> str:
        base = HOSTS[self.host].web_url(self.owner, self.repo)
        if self.ref_kind == "commit":
            return f"{base}/commit/{self.ref}"
        if self.ref:
            return f"{base}/tree/{self.ref}" + (f"/{self.focus_path}" if self.focus_path else "")
        return base

    @property
    def display(self) -> str:
        if self.ref_kind == "commit":
            ref = self.ref[:7]
        else:
            ref = self.ref or "default branch"
        focus = f" ({self.focus_path})" if self.focus_path else ""
        return f"{self.owner}/{self.repo} @ {ref}{focus}"


def _fail(problem: str) -> ValueError:
    return ValueError(f"{problem} Example: {EXAMPLE}")


def _check_ref_segment(segment: str) -> None:
    if (
        not _REF_SEGMENT.fullmatch(segment)
        or segment.startswith(("-", "."))
        or segment.endswith((".", ".lock"))
        or ".." in segment
    ):
        raise _fail(f"'{segment}' is not a valid branch or tag name.")


def _check_path(segments: list[str]) -> str | None:
    for segment in segments:
        if segment in (".", "..") or _PATH_SEGMENT_FORBIDDEN.search(segment):
            raise _fail("The link contains an invalid file path.")
    return "/".join(segments) or None


def parse_repository_url(text: str) -> RepositoryURL:
    """Parse a pasted repository link; raises ValueError with a helpful message."""

    raw = (text or "").strip()

    if not raw:
        raise _fail("Paste a repository link.")
    if len(raw) > MAX_URL_LENGTH:
        raise _fail("The link is too long.")
    if _CONTROL.search(raw):
        raise _fail("Use a single https link to an owner/repository.")

    # scp-like SSH syntax: git@github.com:owner/repo.git
    if re.match(r"^[\w.-]+@[\w.-]+:", raw) and "://" not in raw:
        raise _fail("SSH links are not supported; use the https link.")

    # owner/repo shorthand (no scheme, first part not a hostname)
    if "://" not in raw and re.fullmatch(r"[^/.:@]+/[^/:@]+", raw.rstrip("/")):
        raw = f"https://github.com/{raw}"
    elif "://" not in raw and not raw.startswith("//"):
        first = raw.split("/", 1)[0].lower()
        if first in _HOST_BY_NAME:
            raw = f"https://{raw}"

    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        raise _fail("This is not a valid link.") from None

    scheme = parts.scheme.lower()
    if scheme not in ("https", "http"):
        raise _fail("Only https:// links are supported.")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise _fail("Links must not contain credentials or tokens.")
    if port is not None:
        raise _fail("Links must not specify a port.")

    hostname = (parts.hostname or "").lower()
    host = _HOST_BY_NAME.get(hostname)
    if host is None:
        shown = hostname.encode("ascii", "backslashreplace").decode() or "nothing"
        raise _fail(f"Only {_SUPPORTED_NAMES} repositories are supported (got '{shown}').")

    segments = [unquote(segment) for segment in parts.path.split("/") if segment]
    if len(segments) < 2:
        raise _fail("The link must point to an owner/repository.")

    owner, repo = segments[0], segments[1]
    repo = repo[:-4] if repo.lower().endswith(".git") else repo

    if not host.owner_pattern.fullmatch(owner):
        raise _fail(f"'{owner}' is not a valid {host.name} owner name.")
    if not host.repo_pattern.fullmatch(repo) or repo in (".", ".."):
        raise _fail(f"'{repo}' is not a valid repository name.")

    rest = segments[2:]
    base = {"host": host.hostname, "owner": owner, "repo": repo}

    if not rest or rest[0] not in ("tree", "blob", "commit"):
        # Repository root, or another page of it (issues, pulls, ...).
        return RepositoryURL(**base)

    kind, tail = rest[0], rest[1:]

    if kind == "commit":
        sha = tail[0] if tail else ""
        if _SHA.fullmatch(sha):
            return RepositoryURL(**base, ref=sha.lower(), ref_kind="commit")
        if _HEX.fullmatch(sha):
            raise _fail("Use the full 40-character commit SHA.")
        raise _fail("The commit link does not contain a valid commit SHA.")

    if not tail:
        raise _fail("The link is missing a branch or tag name.")

    # Branch names may contain '/', so try the shortest ref first and move
    # segments from the path into the ref on fallback.
    ref_segments = tail[0].split("/") if "/" in tail[0] else [tail[0]]
    path_segments = tail[1:]
    for segment in ref_segments:
        _check_ref_segment(segment)
    _check_path(path_segments)

    if kind == "blob" and not path_segments:
        raise _fail("A blob link must include a file path.")

    candidates = []
    for extra in range(min(len(path_segments), _MAX_REF_SEGMENTS - 1) + 1):
        moved = path_segments[:extra]
        if any(not _REF_SEGMENT.fullmatch(s) or ".." in s for s in moved):
            break
        if kind == "blob" and extra == len(path_segments):
            break
        ref = "/".join([*ref_segments, *moved])
        candidates.append((ref, _check_path(path_segments[extra:])))

    ref, focus = candidates[0]
    return RepositoryURL(
        **base,
        ref=ref,
        ref_kind="branch",
        focus_path=focus,
        ref_candidates=tuple(candidates),
    )
