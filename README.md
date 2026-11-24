# CodeLens AI

A local, single-user tool to understand a code repository: import it, explore its structure and
dependencies, check it with static analyzers, and (only when you allow it) ask an AI to explain
code or findings. It runs on your machine and is meant for `localhost` use.

## Features

- **Import** a public repository from a link, or upload a ZIP. Imports run as background jobs with
  progress and Cancel.
- **Overview:** file and finding statistics, an optional AI summary, and **Export report** (below).
- **Architecture:**
  - A **Tree** of the real folders and files, showing for each file how many repository files it imports (↗) and how many import it (↙), plus cycle markers and issue counts.
  - Filters (in cycles, no importers, most dependents), search, and a side panel listing imports and importers.
  - Lists of import cycles, external packages, standard-library imports, and unresolved imports and skipped files with reasons.
- **Issues:** findings from Ruff, Bandit, Semgrep and Gitleaks, merged and de-duplicated, with search, severity and analyzer filters, source context, and **Explain finding** / **Suggest fix**.
- **File preview:** a read-only code viewer (CodeMirror 6) with highlighting for Python and JS/TS, `#L<line>` links, finding markers, and **Explain this file / Explain selection**.
- **Export:** one self-contained HTML report (opens offline from `file://`, light and dark), plus JSON and SARIF. Exporting never calls the AI; the saved AI summary is included only if you tick it.
- Every page has its own URL (refresh and back/forward keep your place), there are light and dark themes, and it's keyboard accessible (0 axe violations in our checks).

## Privacy

- **AI is off for every repository** until you click *Allow AI for this repository*. Every AI button
  says what will be sent and to which provider and model. Nothing is sent automatically, and AI
  calls are never retried on the same key.
- **What can be sent:**
  - Explain this file: the file, up to 12,000 characters.
  - Explain selection: only the selected lines, at most 60.
  - Explain finding / Suggest fix: rule id, message, path and at most 11 lines around it.
  - Summary: a fact sheet (languages, dependencies, structure, top findings, README start, signatures), not full source.
  - Ask AI (repository chat): your question, the last few messages, a short fact sheet and up to 3 code
    excerpts of about 40 lines from the files most related to the question (found locally by matching
    words in paths and code).
- **Never sent, listed or previewed:**
  - `.env*`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.htpasswd`, `.pgpass`
  - `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`
  - SSH keys (`id_rsa`, `id_ed25519`, …), `secrets.*`, `.aws/credentials`, `credentials.json`, `service-account.json`
- **Redacted from everything sent out:** API keys and tokens (AWS, GitHub, Slack, Stripe, Groq,
  OpenAI, Anthropic, Google), JWTs, private keys, passwords in URLs, and values assigned to
  secret-looking names. Paths are repository-relative.
- **Token budget:** every request is counted before it is sent (about 4 characters per token).
  The defaults are 3,000 input and 700 output tokens, which fit the smallest free tiers. Change them with
  `CODELENS_LLM_MAX_INPUT_TOKENS` and `CODELENS_LLM_MAX_OUTPUT_TOKENS`. Over-budget requests are trimmed or refused
  locally. A provider's 413 is never retried; a 429 only moves the request to the next key in the pool.
- **Providers:** Groq (hosted) or Ollama (runs locally, so code stays on your machine). Errors shown
  to you never contain provider output, keys or local paths.
- **Several Groq keys:** put them in `GROQ_API_KEYS`, separated by commas. Requests use the keys in
  turn. A key that hits its per-minute limit rests until its limit resets (Groq's `retry-after`) and the
  request goes to the next key. A key Groq rejects is skipped until the backend restarts. Keys are
  never logged; only their position (#1, #2...) is.

## Install (Windows)

Requirements: Python 3.10+, Node.js 20+, Git.

```powershell
git clone <this repository> CodeLens-AI; cd CodeLens-AI
py -m venv venv; .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env      # then set GROQ_API_KEY, or choose Ollama
cd frontend; npm install; cd ..
```

**Optional analyzers:** Ruff and Bandit come with `requirements.txt`.
- **Gitleaks:** a standalone binary from its GitHub releases; put it on `PATH`.
- **Semgrep:** has no native Windows build. Run the backend under **WSL or Docker** to use it. Without it, the report says it did not run.

On macOS/Linux, the same steps work with `python3 -m venv venv && source venv/bin/activate`.
`pip install -r requirements-analyzers.txt` adds Semgrep there.

## Run

Backend (terminal 1, from the project root):

```powershell
.\venv\Scripts\Activate.ps1; python -m uvicorn backend.main:app --port 8000
```

Frontend (terminal 2):

```powershell
cd frontend; npm run dev
```

Open http://localhost:5173. The frontend expects the API at `http://127.0.0.1:8000` (override with
`VITE_API_URL`).

## Deploy (Docker / Render)

The `Dockerfile` builds one container: the backend serves the built frontend on `$PORT`
(default 7860), with Git, Ruff, Bandit and Gitleaks included (Semgrep with
`--build-arg WITH_SEMGREP=true`).

```powershell
docker build -t codelens-ai .
docker run -p 7860:7860 -e GROQ_API_KEYS=gsk_a,gsk_b codelens-ai
```

**Render (free):** `render.yaml` describes the service. Open
<https://render.com/deploy?repo=https://github.com/sid3305/CodeLens-AI>, sign in, and enter your
Groq key(s) for `GROQ_API_KEYS` when asked. The free plan sleeps after 15 minutes without
visitors (the next visit wakes it in about a minute) and has no disk: imported repositories are
lost when it restarts or sleeps.

## Supported import links

Links to repositories on GitHub, GitLab, Bitbucket, Codeberg and other Gitea hosts:
- plain repository URLs, `owner/repo`, and `.git` clone URLs;
- `/tree/<branch>/<folder>`, including branch names that contain `/`;
- `/blob/<branch>/<file>`;
- `/commit/<sha>`.

The import clones exactly that ref and opens the folder or file the link pointed at. Only public
repositories work: private ones get a clear message.

## Tests

```powershell
pytest                       # backend (timing test excluded)
pytest -m perf               # the 2,000-file timing budget; machine-dependent
cd frontend; npm test        # frontend
```

Tests never call a live AI provider.

## Known limitations

- **Languages:** dependency analysis covers Python and JavaScript/TypeScript only.
- **Imports:** public repositories only (no credentials are used), or ZIP uploads.
- **Jobs:** they live in memory, so a backend restart forgets running jobs (finished results are saved). Cancel takes effect between steps, not in the middle of a clone or a single analyzer.
- **Access:** no authentication or multi-user support. Bind to localhost; don't expose it on a network.
- **AI output:** it can be wrong. Answers are shown as AI-generated and are never applied to code.

## Future work

Repository chat with retrieval and file:line citations; issue grouping, triage states and keyboard
navigation; an interactive dependency graph; an Overview redesign with a health score; a single
import dialog; CI and Docker packaging.

## License

MIT. See [LICENSE](LICENSE).
