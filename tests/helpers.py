"""Helpers for building repositories in tests."""

import io
import zipfile


def make_zip(files: dict[str, str | bytes], *, prefix: str = "") -> bytes:
    """Build an in-memory ZIP archive from a {path: content} mapping."""

    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, "w") as archive:
        for path, content in files.items():
            archive.writestr(f"{prefix}{path}", content)

    return buffer.getvalue()


SAMPLE_REPO = {
    "app/main.py": "import os\n\ndef main():\n    return os.getcwd()\n",
    "app/util.py": "def helper():\n    return 1\n",
    "README.md": "# Sample\n",
}


def upload_repo(client, files=None, *, name="sample.zip", prefix="sample/"):
    """Upload a ZIP through the API and return the repository record."""

    archive = make_zip(files or SAMPLE_REPO, prefix=prefix)
    response = client.post(
        "/api/repositories/upload",
        files={"file": (name, archive, "application/zip")},
    )
    assert response.status_code == 200, response.text
    return response.json()
