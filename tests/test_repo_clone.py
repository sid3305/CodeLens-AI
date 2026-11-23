"""X1: cloning the ref a link points at, and clear errors for private repos."""

import subprocess
from pathlib import Path

import pytest

from utils import file_handler

SHA = "0123456789abcdef0123456789abcdef01234567"


class FakeGit:
    """Records git invocations and simulates clone/fetch results."""

    def __init__(self, missing_refs=(), stderr=None):
        self.calls = []
        self.missing_refs = set(missing_refs)
        self.stderr = stderr

    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        if self.stderr:
            raise subprocess.CalledProcessError(128, args, stderr=self.stderr)

        command = args[args.index("git") + 1:]
        command = [part for part in command if part not in ("-c", "credential.helper=", "core.askPass=")]

        if "--branch" in args:
            ref = args[args.index("--branch") + 1]
            if ref in self.missing_refs:
                raise subprocess.CalledProcessError(
                    128, args, stderr=f"warning: Could not find remote branch {ref} to clone.\n"
                    f"fatal: Remote branch {ref} not found in upstream origin"
                )

        if "clone" in command or "init" in command:
            destination = Path(args[-1])
            destination.mkdir(parents=True, exist_ok=True)
            (destination / "main.py").write_text("x = 1\n")
            (destination / "src").mkdir(exist_ok=True)
            (destination / "src" / "app.py").write_text("y = 2\n")
        return subprocess.CompletedProcess(args, 0, "", "")

    def commands(self):
        return [args for args, _ in self.calls]


@pytest.fixture
def git(monkeypatch):
    def install(**options):
        fake = FakeGit(**options)
        monkeypatch.setattr(file_handler.subprocess, "run", fake)
        return fake

    return install


def _import(client, url):
    return client.post("/api/repositories/github", json={"repo_url": url})


def test_plain_link_clones_default_branch_safely(client, git):
    fake = git()

    response = _import(client, "owner/repo")

    assert response.status_code == 200, response.text
    (args, kwargs), = fake.calls
    assert "--branch" not in args
    assert args[args.index("--") + 1] == "https://github.com/owner/repo.git"
    assert args[args.index("--depth") + 1] == "1"
    assert "shell" not in kwargs
    assert kwargs["env"]["GIT_TERMINAL_PROMPT"] == "0"
    assert "credential.helper=" in args


def test_tree_link_clones_that_branch_and_focuses_the_folder(client, git):
    fake = git()

    body = _import(client, "https://github.com/owner/repo/tree/release/src").json()

    (args, _), = fake.calls
    assert args[args.index("--branch") + 1] == "release"
    assert args.index("--branch") < args.index("--")
    assert body["ref"] == "release"
    assert body["focus_path"] == "src"


def test_branch_names_with_slashes_fall_back_to_longer_candidates(client, git):
    fake = git(missing_refs={"feature"})

    body = _import(client, "https://github.com/owner/repo/tree/feature/login/src").json()

    branches = [args[args.index("--branch") + 1] for args in fake.commands()]
    assert branches == ["feature", "feature/login"]
    assert body["ref"] == "feature/login"
    assert body["focus_path"] == "src"


def test_unknown_branch_is_a_clear_client_error(client, git, upload_root):
    git(missing_refs={"nope"})

    response = _import(client, "https://github.com/owner/repo/tree/nope")

    assert response.status_code == 400
    assert "'nope'" in response.json()["detail"]
    assert not any(p.is_dir() for p in upload_root.iterdir()) if upload_root.exists() else True


def test_commit_link_fetches_exactly_that_commit(client, git):
    fake = git()

    body = _import(client, f"https://github.com/owner/repo/commit/{SHA}").json()

    commands = fake.commands()
    fetch = next(args for args in commands if "fetch" in args)
    assert fetch[fetch.index("--") + 1:] == ["https://github.com/owner/repo.git", SHA]
    assert any("checkout" in args for args in commands)
    assert body["ref"] == SHA


@pytest.mark.parametrize(
    "stderr",
    [
        "remote: Repository not found.\nfatal: repository 'https://github.com/o/r.git/' not found",
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        "fatal: Authentication failed for 'https://github.com/o/r.git/'",
    ],
)
def test_private_or_missing_repositories_get_a_clear_message(client, git, stderr, upload_root):
    git(stderr=stderr)

    response = _import(client, "https://github.com/o/r")

    assert response.status_code == 400
    assert "private" in response.json()["detail"].lower()
    assert str(upload_root) not in response.text


def test_network_failures_stay_generic(client, git):
    git(stderr="fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host")

    response = _import(client, "https://github.com/o/r")

    assert response.status_code == 502


def test_hostile_links_never_reach_git(client, git):
    fake = git()

    response = _import(client, "https://github.com.evil.io/o/r")

    assert response.status_code == 400
    assert "https://github.com/owner/repository" in response.json()["detail"]
    assert fake.calls == []


# --- preview endpoint --------------------------------------------------------------


def test_parse_endpoint_returns_a_normalised_preview(client):
    response = client.post(
        "/api/repositories/github/parse",
        json={"repo_url": "http://www.github.com/Owner/Repo.git/tree/main/src?x=1"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "host": "github.com",
        "owner": "Owner",
        "repo": "Repo",
        "ref": "main",
        "ref_kind": "branch",
        "focus_path": "src",
        "display": "Owner/Repo @ main (src)",
        "url": "https://github.com/Owner/Repo/tree/main/src",
    }


def test_parse_endpoint_rejects_with_reason(client):
    response = client.post("/api/repositories/github/parse", json={"repo_url": "file:///etc/passwd"})

    assert response.status_code == 400
    assert "https://" in response.json()["detail"]
