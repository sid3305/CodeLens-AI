"""Repository chat: consent, retrieval, budget, history and privacy. The LLM is faked."""

from agents.chat_agent import Excerpt, build_request
from backend.services.chat_service import question_terms
from tests.helpers import allow_ai, upload_repo

FILES = {
    "app/auth.py": "\n".join(
        ["import hashlib", ""] + [f"# filler {i}" for i in range(60)] +
        ["def check_password(user, password):", "    return hashlib.sha256(password.encode()).hexdigest() == user.hash"]
    ),
    "app/billing.py": "def charge(amount):\n    return amount * 2\n",
    "README.md": "# Shop\nA small shop backend.\n",
    ".env": "GROQ_API_KEY=gsk_live_password_value\n",
    "config.py": "API_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'\n# password settings\n",
}


def _url(repo):
    return f"/api/repositories/{repo['id']}/chat"


def test_chat_needs_consent(client, fake_llm):
    repo = upload_repo(client, FILES)
    response = client.post(_url(repo), json={"question": "Where is the password checked?"})
    assert response.status_code == 403
    assert fake_llm.calls == []


def test_answer_uses_related_code_and_is_saved(client, fake_llm):
    repo = upload_repo(client, FILES)
    allow_ai(client, repo)
    fake_llm.response = "In `app/auth.py:63`."

    response = client.post(_url(repo), json={"question": "Where is the password checked?"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"]["content"] == "In `app/auth.py:63`."
    files = [source["file"] for source in body["answer"]["sources"]]
    assert files[0] == "app/auth.py"
    (sent,) = fake_llm.calls
    assert "check_password" in sent and "Question: Where is the password checked?" in sent
    # The window holds the matching lines, numbered for citations.
    assert "64|     return hashlib" in sent
    # Never sensitive files, and secrets are redacted.
    assert ".env" not in files and "gsk_live_password_value" not in sent
    assert "ghp_abcdefghijklmnopqrstuvwxyz0123456789" not in sent

    history = client.get(_url(repo)).json()["messages"]
    assert [m["role"] for m in history] == ["user", "assistant"]


def test_follow_up_sends_the_conversation(client, fake_llm):
    repo = upload_repo(client, FILES)
    allow_ai(client, repo)
    fake_llm.response = "It is in auth.py."
    client.post(_url(repo), json={"question": "Where is the password checked?"})
    client.post(_url(repo), json={"question": "And what hash does it use?"})

    assert "User: Where is the password checked?" in fake_llm.calls[1]
    assert "Assistant: It is in auth.py." in fake_llm.calls[1]


def test_clear_history(client, fake_llm):
    repo = upload_repo(client, FILES)
    allow_ai(client, repo)
    client.post(_url(repo), json={"question": "What does billing do?"})

    assert client.delete(_url(repo)).json()["messages"] == []
    assert client.get(_url(repo)).json()["messages"] == []


def test_ai_failure_saves_nothing(client, fake_llm):
    from utils.llm import AIServiceError

    repo = upload_repo(client, FILES)
    allow_ai(client, repo)
    fake_llm.error = AIServiceError("Groq's per-minute limit was reached on every key.")

    response = client.post(_url(repo), json={"question": "What does billing do?"})

    assert response.status_code == 502
    assert "per-minute" in response.json()["detail"]
    assert client.get(_url(repo)).json()["messages"] == []


def test_question_is_validated(client):
    repo = upload_repo(client, FILES)
    allow_ai(client, repo)
    assert client.post(_url(repo), json={"question": ""}).status_code == 422
    assert client.post(_url(repo), json={"question": "x" * 1001}).status_code == 422


def test_unknown_repository(client):
    assert client.get("/api/repositories/nope/chat").status_code == 404


def test_request_fits_the_budget_dropping_low_priority_parts():
    big = Excerpt("a.py", 1, 40, "x = 1\n" * 2000)
    small = Excerpt("b.py", 1, 2, "def b():\n    pass")
    history = [{"role": "user", "content": "old " * 200}, {"role": "assistant", "content": "reply"}]

    request, used = build_request("What is b?", history, ["Repository: demo"], [small, big])

    assert request.input_tokens <= 3000
    assert used == [small]
    assert "Repository: demo" in request.prompt and "Assistant: reply" in request.prompt


def test_terms_split_identifiers():
    terms = question_terms("How does getUserName call fetch_profile?")
    assert {"getusername", "user", "name", "fetch_profile", "fetch", "profile"} <= set(terms)
    assert "does" not in terms and "how" not in terms
