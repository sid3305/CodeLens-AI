
from pydantic import BaseModel, Field


class GitHubImportRequest(BaseModel):
    repo_url: str = Field(
        ...,
        min_length=1,
        description="HTTPS URL of a public GitHub repository",
    )


class RepositoryResponse(BaseModel):
    id: str
    name: str
    source: str
    file_count: int
    created_at: str


class RepositoryFileResponse(BaseModel):
    path: str
    name: str
    extension: str


class RepositoryFilesResponse(BaseModel):
    repository_id: str
    total_files: int
    files: list[RepositoryFileResponse]


from pydantic import BaseModel


class AnalyzerStatus(BaseModel):
    status: str
    findings: int
    error: str | None = None


class AnalysisSummary(BaseModel):
    total_findings: int
    raw_total_findings: int
    duplicates_removed: int
    severity_counts: dict[str, int]
    category_counts: dict[str, int]
    tool_counts: dict[str, int]


class AnalysisResponse(BaseModel):
    repository_id: str
    repository_name: str
    status: str
    analyzed_at: str
    summary: AnalysisSummary
    tool_status: dict[str, AnalyzerStatus]
    findings: list[dict]
