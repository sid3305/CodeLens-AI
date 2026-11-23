from pydantic import BaseModel, Field


class SummaryRequest(BaseModel):
    """Request to generate an AI repository summary."""


class SummaryResponse(BaseModel):
    """AI-generated repository summary response."""
    repository_id: str
    repository_name: str
    summary: str
    generated_at: str
    truncated: bool = False


class AiConsentRequest(BaseModel):
    enabled: bool


class AiConsentResponse(BaseModel):
    """Whether AI is on for a repository, and who would receive the code."""
    repository_id: str
    enabled: bool
    provider: str
    model: str
    configured: bool
    problem: str | None = None


class ExplainRequest(BaseModel):
    """Request to explain a specific file."""
    file_path: str = Field(..., description="Repository-relative file path")


class ExplainResponse(BaseModel):
    """AI-generated file explanation response."""
    repository_id: str
    file_path: str
    explanation: str
    generated_at: str
    truncated: bool = False