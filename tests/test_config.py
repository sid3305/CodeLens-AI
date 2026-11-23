"""A9 / BUG-23: the repository store must not depend on the working directory."""

from pathlib import Path

from tests.conftest import PROJECT_ROOT
from tests.helpers import upload_repo


def test_default_upload_dir_is_absolute_and_cwd_independent(tmp_path, monkeypatch):
    from utils.config import get_upload_dir

    monkeypatch.delenv("CODELENS_UPLOAD_DIR", raising=False)
    monkeypatch.chdir(tmp_path)

    upload_dir = get_upload_dir()

    assert upload_dir.is_absolute()
    assert upload_dir == (PROJECT_ROOT / "uploads").resolve()


def test_relative_override_resolves_against_project_root(tmp_path, monkeypatch):
    from utils.config import get_upload_dir

    monkeypatch.setenv("CODELENS_UPLOAD_DIR", "data/repos")
    monkeypatch.chdir(tmp_path)

    assert get_upload_dir() == (PROJECT_ROOT / "data" / "repos").resolve()


def test_store_follows_configuration_at_runtime(client, tmp_path, monkeypatch):
    """Changing the setting after import must take effect (no import-time copies)."""

    elsewhere = tmp_path / "elsewhere"
    monkeypatch.setenv("CODELENS_UPLOAD_DIR", str(elsewhere))

    repo = upload_repo(client)

    assert (elsewhere / repo["id"]).is_dir()
    assert (elsewhere / ".codelens_repositories.json").is_file()
    assert [r["id"] for r in client.get("/api/repositories").json()] == [repo["id"]]


def test_env_example_documents_upload_dir():
    text = (PROJECT_ROOT / ".env.example").read_text(encoding="utf-8")
    assert "CODELENS_UPLOAD_DIR" in text


def test_no_module_captures_upload_dir_at_import():
    offenders = []

    for path in [*PROJECT_ROOT.glob("backend/**/*.py"), *PROJECT_ROOT.glob("utils/**/*.py")]:
        text = Path(path).read_text(encoding="utf-8")
        if "import UPLOAD_DIR" in text or "UPLOAD_DIR," in text or "UPLOAD_DIR =" in text:
            offenders.append(path.relative_to(PROJECT_ROOT).as_posix())

    assert offenders == []
