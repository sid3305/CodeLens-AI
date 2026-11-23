"""X3 smoke test: the exported report is offline, relative-path only and redacted."""

import json
import re
from pathlib import Path

from tests.helpers import upload_repo
from utils import analysis_engine

SECRET = "sk_live_51HxAbCdEfGhIjKlMnOpQrStUv"


def test_export_is_self_contained_and_leaks_nothing(client, monkeypatch, upload_root):
    finding = {"tool": "Ruff", "rule_id": "S105", "title": "Hardcoded key", "severity": "High",
               "line": 2, "description": "Key in source", "recommendation": "Use env"}
    monkeypatch.setattr(analysis_engine, "run_ruff_analysis", lambda p: [{**finding, "file": f"{p}/app/main.py"}])
    for name in ("run_bandit_analysis", "run_semgrep_analysis", "run_gitleaks_analysis"):
        monkeypatch.setattr(analysis_engine, name, lambda _p: [])
    repo = upload_repo(client, {"app/main.py": f"import os\nKEY = '{SECRET}'\n", "app/util.py": "from app import main\n",
                                ".env": "GROQ_API_KEY=gsk_realkey1234567890abcdef\n"})
    client.post(f"/api/repositories/{repo['id']}/analyze")

    url = f"/api/repositories/{repo['id']}/export"
    html, data, sarif = (client.get(url, params={"format": f}) for f in ("html", "json", "sarif"))

    assert html.status_code == data.status_code == sarif.status_code == 200
    page = html.text
    assert "default-src 'none'" in page and not re.search(r"\s(src|href)\s*=", page)
    assert not re.search(r"https?://(?!json\.schemastore)", page)
    for text in (page, data.text, sarif.text):
        for leak in (SECRET, "gsk_realkey", str(upload_root), str(Path.home())):
            assert leak not in text
    report = data.json()
    assert report["findings"][0]["file"] == "app/main.py" and report["findings"][0]["snippet"]
    assert report["ai_summary"] is None and ".env" not in report["files"]
    assert json.loads(sarif.text)["runs"][0]["results"][0]["locations"][0]["physicalLocation"]["artifactLocation"]["uri"] == "app/main.py"
