from fastapi import APIRouter, HTTPException

from agents import chat_agent
from backend.routers.ai import ai_error, require_ai_consent
from backend.schemas.ai import ChatHistoryResponse, ChatRequest, ChatResponse
from backend.services.ai_cache import cached_answer, fingerprint
from backend.services.chat_service import (
    append_messages,
    chat_facts,
    clear_history,
    find_excerpts,
    load_history,
    new_message,
)
from backend.services.repository_service import get_repository

router = APIRouter(prefix="/api/repositories", tags=["Repository chat"])


def _repository(repo_id: str) -> dict:
    try:
        return get_repository(repo_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.get("/{repo_id}/chat", response_model=ChatHistoryResponse)
def get_chat(repo_id: str):
    """The conversation so far (never calls the AI)."""

    _repository(repo_id)
    return ChatHistoryResponse(repository_id=repo_id, messages=load_history(repo_id))


@router.delete("/{repo_id}/chat", response_model=ChatHistoryResponse)
def delete_chat(repo_id: str):
    _repository(repo_id)
    clear_history(repo_id)
    return ChatHistoryResponse(repository_id=repo_id, messages=[])


@router.post("/{repo_id}/chat", response_model=ChatResponse)
def ask(repo_id: str, request: ChatRequest):
    """
    Answer a question about the repository. Sends the question, the last
    few messages, a fact sheet and up to 3 related code excerpts (redacted,
    never from sensitive files), fitted to the token budget.
    """

    repository = _repository(repo_id)
    require_ai_consent(repository)

    history = load_history(repo_id)
    try:
        excerpts = find_excerpts(repository, request.question)
        built, used = chat_agent.build_request(request.question, history, chat_facts(repository), excerpts)
        text, cached = cached_answer(
            repo_id, "chat", fingerprint(built.system, built.prompt),
            lambda: chat_agent.run_chat_agent(built), force=request.force,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        raise ai_error(error)

    question = new_message("user", request.question.strip())
    answer = new_message(
        "assistant", text,
        sources=[{"file": e.file, "start_line": e.start_line, "end_line": e.end_line} for e in used],
        input_tokens=built.input_tokens,
        cached=cached,
    )
    append_messages(repo_id, [question, answer])
    return ChatResponse(repository_id=repo_id, question=question, answer=answer)
