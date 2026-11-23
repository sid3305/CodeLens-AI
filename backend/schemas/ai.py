from typing import Literal

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


class FindingAiRequest(BaseModel):
    """B5: explain a finding, or suggest a fix for it."""
    mode: Literal["explain", "fix"]


class FindingAiSent(BaseModel):
    """Exactly which code was sent (null lines: no code was sent)."""
    file: str
    start_line: int | None
    end_line: int | None


class FindingAiResponse(BaseModel):
    repository_id: str
    finding_id: str
    mode: Literal["explain", "fix"]
    text: str
    generated_at: str
    sent: FindingAiSent


MAX_SELECTION_LINES = 60


class AiEstimateRequest(BaseModel):
    """What a task would send, counted without sending it."""
    task: Literal["summary", "explain", "finding"]
    file_path: str | None = None
    start_line: int | None = Field(None, ge=1)
    end_line: int | None = Field(None, ge=1)
    finding_id: str | None = None
    mode: Literal["explain", "fix"] = "explain"


class AiEstimateResponse(BaseModel):
    input_tokens: int
    output_tokens: int
    max_input_tokens: int
    within_budget: bool


class ExplainRequest(BaseModel):
    """Request to explain a file, or only some of its lines (C5)."""
    file_path: str = Field(..., description="Repository-relative file path")
    start_line: int | None = Field(None, ge=1, description="First selected line (1-based)")
    end_line: int | None = Field(None, ge=1, description="Last selected line (inclusive)")


class ExplainResponse(BaseModel):
    """AI-generated file explanation response."""
    repository_id: str
    file_path: str
    start_line: int | None = None
    end_line: int | None = None
    explanation: str
    generated_at: str
    truncated: bool = False