"""X1: accept any normal repository link, reject everything else clearly."""

import pytest

from utils.repo_url import HOSTS, parse_repository_url

SHA = "0123456789abcdef0123456789abcdef01234567"


# (input, owner, repo, ref, ref_kind, focus_path)
VALID = [
    ("https://github.com/owner/repo", "owner", "repo", None, None, None),
    ("https://github.com/owner/repo.git", "owner", "repo", None, None, None),
    ("https://github.com/owner/repo/", "owner", "repo", None, None, None),
    ("https://github.com/owner/repo.git/", "owner", "repo", None, None, None),
    ("https://www.github.com/owner/repo", "owner", "repo", None, None, None),
    ("http://github.com/owner/repo", "owner", "repo", None, None, None),
    ("https://GitHub.com/Owner/Repo", "Owner", "Repo", None, None, None),
    ("  https://github.com/owner/repo  ", "owner", "repo", None, None, None),
    ("https://github.com/owner/repo?tab=readme-ov-file", "owner", "repo", None, None, None),
    ("https://github.com/owner/repo#readme", "owner", "repo", None, None, None),
    ("github.com/owner/repo", "owner", "repo", None, None, None),
    ("www.github.com/owner/repo", "owner", "repo", None, None, None),
    ("owner/repo", "owner", "repo", None, None, None),
    ("my-org/my.repo_name-2", "my-org", "my.repo_name-2", None, None, None),
    ("https://github.com/owner/repo/tree/main", "owner", "repo", "main", "branch", None),
    ("https://github.com/owner/repo/tree/main/", "owner", "repo", "main", "branch", None),
    ("https://github.com/owner/repo/tree/main/src/app", "owner", "repo", "main", "branch", "src/app"),
    ("https://github.com/owner/repo/tree/v1.2.0", "owner", "repo", "v1.2.0", "branch", None),
    ("https://github.com/owner/repo/blob/dev/README.md", "owner", "repo", "dev", "branch", "README.md"),
    ("https://github.com/owner/repo/blob/main/src/a.py#L10", "owner", "repo", "main", "branch", "src/a.py"),
    (f"https://github.com/owner/repo/commit/{SHA}", "owner", "repo", SHA, "commit", None),
    ("https://github.com/owner/repo/issues/12", "owner", "repo", None, None, None),
    ("https://github.com/owner/repo/pulls", "owner", "repo", None, None, None),
    ("https://github.com/owner/repo/tree/feature%2Fx", "owner", "repo", "feature/x", "branch", None),
]


@pytest.mark.parametrize(("text", "owner", "repo", "ref", "kind", "focus"), VALID)
def test_valid_links_are_normalised(text, owner, repo, ref, kind, focus):
    parsed = parse_repository_url(text)

    assert (parsed.owner, parsed.repo) == (owner, repo)
    assert parsed.ref == ref
    assert parsed.ref_kind == kind
    assert parsed.focus_path == focus
    assert parsed.clone_url == f"https://github.com/{owner}/{repo}.git"
    assert parsed.host == "github.com"


def test_branch_names_with_slashes_are_tried_longest_last():
    parsed = parse_repository_url("https://github.com/o/r/tree/feature/login/src/app")

    assert parsed.ref_candidates == (
        ("feature", "login/src/app"),
        ("feature/login", "src/app"),
        ("feature/login/src", "app"),
    )


def test_display_text():
    assert parse_repository_url("o/r").display == "o/r @ default branch"
    assert parse_repository_url("https://github.com/o/r/tree/main/src").display == "o/r @ main (src)"
    assert parse_repository_url(f"https://github.com/o/r/commit/{SHA}").display == f"o/r @ {SHA[:7]}"


# (input, fragment of the error message)
HOSTILE = [
    ("", "Paste"),
    ("   ", "Paste"),
    ("https://user:pass@github.com/o/r", "credentials"),
    ("https://ghp_token@github.com/o/r", "credentials"),
    ("git@github.com:o/r.git", "SSH"),
    ("ssh://git@github.com/o/r", "https://"),
    ("git://github.com/o/r", "https://"),
    ("file:///etc/passwd", "https://"),
    ("ftp://github.com/o/r", "https://"),
    ("javascript:alert(1)", "https://"),
    ("https://gitlab.com/o/r", "GitHub"),
    ("https://bitbucket.org/o/r", "GitHub"),
    ("https://github.com.evil.io/o/r", "GitHub"),
    ("https://evil.io/github.com/o/r", "GitHub"),
    ("https://github.co/o/r", "GitHub"),
    ("https://gіthub.com/o/r", "GitHub"),  # Cyrillic і
    ("https://xn--gthub-n4a.com/o/r", "GitHub"),
    ("https://github.com:8443/o/r", "port"),
    ("https://github.com/", "owner/repository"),
    ("https://github.com/o", "owner/repository"),
    ("o", "owner/repository"),
    ("o/r/extra", "owner/repository"),
    ("https://github.com/o;rm -rf/r", "owner"),
    ("https://github.com/o/r;rm -rf ~", "repository name"),
    ("https://github.com/-o/r", "owner"),
    ("https://github.com/o/..", "repository name"),
    ("https://github.com/--upload-pack=touch%20x/r", "owner"),
    ("https://github.com/o/r/tree/", "branch"),
    ("https://github.com/o/r/tree/--upload-pack=x", "branch"),
    ("https://github.com/o/r/tree/main/../../etc", "path"),
    ("https://github.com/o/r/tree/a..b", "branch"),
    ("https://github.com/o/r/commit/not-a-sha", "commit"),
    ("https://github.com/o/r/commit/abc1234", "40-character"),
    ("https://github.com/o/r/blob/main", "file path"),
    ("https://github.com/o/r\n/tree/main", "owner/repository"),
    ("https://github.com/" + "a" * 3000, "too long"),
]


@pytest.mark.parametrize(("text", "message"), HOSTILE)
def test_hostile_or_unsupported_links_are_rejected(text, message):
    with pytest.raises(ValueError) as error:
        parse_repository_url(text)

    assert message.lower() in str(error.value).lower()


@pytest.mark.parametrize(("text", "_message"), HOSTILE[2:])
def test_rejections_show_an_accepted_example(text, _message):
    with pytest.raises(ValueError) as error:
        parse_repository_url(text)

    assert "https://github.com/owner/repository" in str(error.value)


def test_host_table_is_the_only_extension_point():
    assert set(HOSTS) == {"github.com"}
    github = HOSTS["github.com"]
    assert github.clone_url("o", "r") == "https://github.com/o/r.git"
