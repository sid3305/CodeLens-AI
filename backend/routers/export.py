"""X3: download a static report (self-contained HTML, JSON or SARIF)."""

import json
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response

from backend.services.export_service import build_report, to_html, to_sarif

router = APIRouter(prefix="/api/repositories", tags=["Export"])

MEDIA = {
    "html": ("text/html; charset=utf-8", "html"),
    "json": ("application/json", "json"),
    "sarif": ("application/sarif+json", "sarif"),
}


@router.get("/{repo_id}/export")
def export_report(
    repo_id: str,
    format: Literal["html", "json", "sarif"] = Query("html"),
    include_summary: bool = Query(False, description="Include the saved AI summary (never generates one)"),
):
    try:
        report = build_report(repo_id, include_summary=include_summary)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))

    if format == "html":
        body = to_html(report)
    elif format == "sarif":
        body = json.dumps(to_sarif(report), indent=2)
    else:
        body = json.dumps(report, indent=2)

    media_type, extension = MEDIA[format]
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", report["repository"]["name"]).strip("-") or "repository"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{name}-codelens-report.{extension}"'},
    )
