# CodeLens AI — Project Review (Phase 1, read-only)

**Review date:** 2026-11-23
**Environment:** Windows 11, Python 3.12.10, Node 24.11.0, Microsoft Edge (headless, via Playwright) for UI testing.
**Scope:** Every source file in `backend/`, `utils/`, `agents/`, `prompts/`, `tests/`, and `frontend/src/` was read. `app.py` (the legacy Streamlit UI) was skimmed only.

**What I changed on disk:** none of your existing files were modified. I created these:
- `.review-scratch/`: a Python venv (~480 MB), raw API outputs, generated test fixtures, Playwright scripts (`ui1.js`, `ui2.js`), and screenshots. You can delete the whole folder.
- `frontend/node_modules/` and `frontend/dist/`, from `npm install` and `npm run build`. Both are gitignored.
- The app created an `uploads/` folder during testing. I deleted every repository I imported and then removed that folder, because it did not exist before.

**Assumptions:**
- Gitleaks is not installed on this machine, and I did not download its binary. Semgrep **cannot** be installed on native Windows (see BUG-01). So analysis ran with Ruff and Bandit only. This is what any Windows user of this project will get.
- The Groq key in `.env` is rejected by Groq with **401 Invalid API Key**. To exercise the frontend AI flows I mocked the `/summary` and `/files/explain` responses in the browser. Backend AI error paths were tested live.

---

## 1. Project Summary

CodeLens AI is a local "repository intelligence" workspace. You import a codebase (ZIP upload or public GitHub URL) and it does four things:
1. Lists and previews the source files.
2. Runs static analyzers (Ruff, Bandit, Semgrep, Gitleaks), then normalizes and de-duplicates their findings into one severity-ranked list.
3. Builds a Tree-sitter/NetworkX code graph to report internal, external and circular dependencies.
4. Uses a Groq-hosted LLM (`openai/gpt-oss-120b`) to summarize the repository and explain individual files.

The stack is a FastAPI backend (`backend/`, `utils/`, `agents/`) and a React 19 + TypeScript + Vite 8 frontend (`frontend/`) with a three-pane layout: explorer, workspace, AI assistant. A legacy Streamlit UI (`app.py`) is still in the repo. The target user is a developer onboarding onto an unfamiliar codebase.

The honest picture: the **import, file browsing and static-analysis pipeline works** and is reasonably well defended. **Dependency analysis returns wrong answers.** **AI chat and graphs are UI mock-ups.** **6 of the 10 workspace sections are placeholders.** There are effectively **no automated tests**.

---

## 2. Overall Health Score

| Area | Score | One-line justification |
|---|---|---|
| Functionality | **4/10** | Import, preview and analysis work. Dependencies give wrong results, chat is fake, 6/10 nav sections are placeholders, and summary/explanation show stale data. |
| Code Quality | **4/10** | Sensible layering, but heavy duplication (5 copy-pasted dependency endpoints, 113 duplicated CSS selectors, two type files). 13 ESLint errors, 31 unused imports/variables, and a 1,133-line dead Streamlit app. |
| UI/UX | **4/10** | The desktop visual language is clean and calm. Key buttons are unstyled, the Dependencies page is ~75% unstyled, mobile is broken, and there are dead controls everywhere. |
| Performance | **3/10** | An infinite LLM retry loop. Dependency analysis takes 22.6 s for 2,000 one-line files (exact betweenness centrality plus a call graph rebuilt 8,402 times), recomputed on every request. |
| Security | **5/10** | Good path-traversal, zip-slip and symlink defenses. But there is no auth, the zip entry count is unbounded (20k-entry zip took 48 s), absolute server paths leak to the client and the LLM, prompt injection is unmitigated, and `.env` with a key is in the distributed tree. |
| Testing | **1/10** | The 3 "tests" are analyzer fixtures plus a script that calls the live Groq API on import. Zero assertions, zero frontend tests, no CI. |
| Documentation | **5/10** | The README is long and well structured, but its Windows install fails, it references a non-existent `.env.example`, its project structure is stale, its API table uses `...` placeholders, and there is no license. |

---

## 3. What's Working Well

- **Path-traversal defenses are solid.** I tried `../`, URL-encoded `..%2F`, backslash `demo\..\..\`, absolute `/etc/passwd`, `C:/Windows/win.ini` and `.env`. All were rejected with 403 (`backend/services/repository_service.py:233-269`).
- **ZIP extraction is defensive.** It rejects zip-slip (`slip.zip` → 400 "unsafe file path") and symlinks (`symlink.zip` → 400), streams in chunks, and caps declared total size (`utils/file_handler.py:89-158`).
- **GitHub URL validation is strict.** It allows HTTPS `github.com` only, rejects credentials and query strings, regex-checks owner and repo, runs `git clone` with an argv list and `--`, and sets a timeout (`utils/file_handler.py:163-223`). It rejected `http://`, `gitlab.com`, `user:pw@`, and `;rm -rf`.
- **Analyzer orchestration is resilient.** A failed or missing tool is reported per tool, and the others still run (`utils/analysis_engine.py:28-52`).
- **The finding normalization and dedup design is good.** There is a common schema, it keeps `tool_details` evidence, and it recognises vulnerability "families" across tools (`utils/finding_deduplicator.py`).
- **Secret redaction** runs on findings and on LLM input (`utils/security.py`, `backend/services/analysis_service.py:17-35`).
- **The analysis lock works.** 4 concurrent `POST /analyze` calls returned `409 409 409 200`.
- **Writes are atomic.** Registry and results use a temp file plus `replace()`.
- **LLM output rendering is XSS-safe.** `MarkdownContent.tsx` builds React nodes and never uses `dangerouslySetInnerHTML`. A mocked `<img src=x onerror=alert(1)>` rendered as inert text.
- **The frontend build passes** (`tsc -b && vite build`, 286 KB JS / 86 KB gzip). `npm audit` and `pip-audit` report 0 known vulnerabilities.
- **The Issues page is the strongest screen.** It has severity tiles, search plus severity/analyzer filters, inline source context with the offending line highlighted, and "open in file preview". Dark mode looks good on desktop.

---

## 4. Critical Issues (fix first)

1. **Infinite AI-summary retry loop (BUG-02).** When summary generation fails (bad key, rate limit, empty repo), `WorkspacePanel.tsx:312-327` re-fires immediately and forever. I measured **11 `POST /summary` calls in 8 s** while idle on Overview, and the page never reaches network idle. Each call re-reads every file in the repo and hits Groq. With a valid key under rate limiting, this burns quota and server CPU continuously.
2. **Wrong-repository AI summary (BUG-03).** After you switch repos, the previous repo's summary stays on screen and no new one is requested. Verified: Hello-World showed "MOCK SUMMARY FOR 15c663" (demo-repo's id). Users are shown confidently wrong information.
3. **Dependency analysis returns incorrect results (BUG-06/07/08).** On a fixture with two real import cycles and internal imports, it reported:
   - 0 circular dependencies.
   - 0 module dependencies.
   - 14 "external packages", including the stdlib modules `os`, `subprocess` and `pickle`, the local modules `b` and `app`, and the imported symbols `React`, `x`, `_` and `main`.

   This is the headline "repository intelligence" feature, and right now it misleads.
4. **The project does not install on Windows as documented (BUG-01).** `pip install -r requirements.txt` hard-fails with *"Semgrep does not support Windows yet"*, yet the README gives Windows setup steps.
5. **No real tests (BUG-20).** `pytest` errors at collection because `tests/test_llm.py` calls the live Groq API at import time (401). Nothing protects any of the logic above.
6. **A secret is in the tree (SEC-01).** `.env` with `GROQ_API_KEY` is present. Groq now rejects that key, but if this folder came from a GitHub "Download ZIP", the file was committed, and the key was publicly exposed.

---

## 5. Full Bug List

Severity: **Critical** = data corruption, misleading output or runaway cost. **High** = core feature broken. **Medium** = wrong behaviour with a workaround. **Low** = polish.

| ID | Sev | Description | Repro | File:line |
|---|---|---|---|---|
| BUG-01 | Critical | `pip install -r requirements.txt` fails on Windows because Semgrep won't build. The README documents a Windows setup. | Fresh venv on Windows → `pip install -r requirements.txt` → "Semgrep does not support Windows yet" | `requirements.txt:13`, `README.md` (Backend Setup) |
| BUG-02 | Critical | Summary auto-generation retries endlessly on failure. The effect depends on `generatingSummary`, which flips back to false after each failure. | Invalid/missing key or an empty repo → open Overview → watch the network: continuous `POST /summary` | `frontend/src/components/layout/WorkspacePanel.tsx:312-327` |
| BUG-03 | Critical | AI summary is not reset when the repository changes, so the previous repo's summary is shown for the new one. | Repo A summary loads → select repo B → A's summary stays | `WorkspacePanel.tsx:306, 312-327` |
| BUG-04 | High | File explanation is not reset when the selected file changes. The wrong explanation shows and the "Explain" button disappears. | Open `app.py` → Explain → open `b.py` → app.py's explanation is shown | `WorkspacePanel.tsx:308, 815` |
| BUG-05 | High | "Regenerate Summary" cannot regenerate. The POST returns the cached summary whenever one exists, and there is no `force` param. | Click Regenerate → same text and timestamp | `backend/routers/ai.py:62-72` |
| BUG-06 | High | Python `from X import a` records the import as `a` and discards module `X`. Multi-line `from x import (\n a)` yields the name `(`. | Dependencies on any Python repo → externals list `APIRouter`-style symbols | `utils/code_graph/python_parser.py:209-233` |
| BUG-07 | High | External-dependency heuristic: everything not starting with `.`/`@` is "external", so it includes stdlib and local modules. Scoped npm packages (`@scope/pkg`) are dropped. `yaml` and `pyyaml` are listed separately. | Fixture → externals: subprocess, pickle, os, b, app, React, x, _, main | `utils/code_graph/dependencies.py:141-154` |
| BUG-08 | High | Circular and internal module dependencies are never detected. Cross-file edges map import *names* to any same-named definition, keyed by name, so collisions overwrite. No real module resolution exists. | Fixture with `demo/app.py`↔`demo/b.py` and `web/index.js`↔`web/util.js` cycles → 0 cycles, 0 module deps. A 2,000-file cyclic chain → 0 cycles. | `utils/code_graph/parser_factory.py:57-83` |
| BUG-09 | High | Deleting a GitHub-imported repo fails with 500 on Windows (`shutil.rmtree` on read-only `.git` objects), leaving it half-deleted. | Import `https://github.com/octocat/Hello-World` → delete → HTTP 500 "Unable to delete the repository workspace." | `backend/services/repository_service.py:302-303` |
| BUG-10 | High | AI Assistant chat is non-functional. Send just clears the textbox. "+ New conversation" and the context dropdown do nothing. | Type a question → Send → text vanishes, no response | `frontend/src/components/layout/AIAssistant.tsx:112-118`, `backend/routers/chat.py` (empty) |
| BUG-11 | High | ~57 of 77 class names used by `DependenciesPanel` have no CSS, so the page renders as raw stacked text and icons. | Open Dependencies (screenshot `06-deps.png`) | `DependenciesPanel.tsx`, `App.css` |
| BUG-12 | High | `.primary-button` has no base styles (only hover/transition), and `--accent-blue-rgb` is undefined. The main CTA "Run Analysis" renders as an unstyled icon over text. | Any page header (screenshot `01-overview-desktop.png`) | `frontend/src/App.css:845-867` |
| BUG-13 | Medium | Failed GitHub clone leaves an orphan workspace directory that no API can delete. | Import a non-existent repo → 502 → `uploads/<uuid>/` remains (empty) | `utils/file_handler.py:190-223`, `repository_service.py:181-204` |
| BUG-14 | Medium | A non-ZIP file named `.zip` returns 500 instead of 400 (`BadZipFile` isn't a `ValueError`). | Upload `notzip.zip` → 500 "Unable to import" | `utils/file_handler.py:113`, `backend/routers/repositories.py:42` |
| BUG-15 | Medium | ZIPs with names invalid on Windows (e.g. `<script>.py`, `aux.py`, `:`) fail the whole import with a generic 500. | Upload `demo.zip` fixture → 500 | `utils/file_handler.py:146-149` |
| BUG-16 | Medium | Empty or non-code ZIPs and repos with 0 source files are accepted and registered (named "repository"). | Upload `empty.zip` → 200, 0 files. Same for `nocode.zip` and Hello-World. | `repository_service.py:138-171` |
| BUG-17 | Medium | AI errors are swallowed (`console.error` only). Users get no feedback when Explain or Summary fail. | Invalid key → click Explain → spinner stops, nothing shown | `WorkspacePanel.tsx:319-321, 344-346` |
| BUG-18 | Medium | "API connected" is hard-coded. It never calls `/api/health` and shows "connected" even when the backend is down. | Stop backend → reload → still "API connected" | `frontend/src/components/layout/AppShell.tsx:273-276` |
| BUG-19 | Medium | "Analysis completed successfully" with "12 findings from 4 analyzers" is shown even when 2 of 4 analyzers failed (Semgrep/Gitleaks missing). | Run analysis without Gitleaks → success banner and "4 analyzers" | `AppShell.tsx:170`, `WorkspacePanel.tsx:624-625` |
| BUG-20 | Medium | The test suite cannot run. `tests/test_llm.py` executes a live API call at import. The other two files are analyzer targets, not tests. | `pytest` → collection error 401 | `tests/test_llm.py:5` |
| BUG-21 | Medium | `max_nodes` query param is validated but ignored (hard-coded 200). | `GET /dependencies?max_nodes=500` → same output | `backend/routers/dependencies.py:32`, `utils/code_graph/dependencies.py:342` |
| BUG-22 | Medium | Dependencies refetch on every repository-list refresh because the `repository` object identity changes. Refresh triggers two full 20 s analyses, and there is no cancellation on repo switch, so responses can race. | Click refresh on Dependencies | `DependenciesPanel.tsx:223-248` |
| BUG-23 | Medium | `uploads/` is resolved relative to the process CWD. Starting uvicorn from another folder silently uses a different store. | `cd backend && uvicorn main:app` | `utils/file_handler.py:14` |
| BUG-24 | Low | Duplicate badge is off by one: `duplicate_count` is `len(group)-1`, but the UI shows it only when `> 1` and labels it "detections". | A finding merged from 2 tools shows no badge | `WorkspacePanel.tsx:206-210`, `finding_deduplicator.py:197` |
| BUG-25 | Low | The Overview empty state says *Click "Generate AI Summary"*, but no such button exists. | Overview with analysis and no summary | `WorkspacePanel.tsx:630-632` |
| BUG-26 | Low | Theme is not persisted and ignores `prefers-color-scheme`. | Switch to Dark → reload → Light | `AppShell.tsx:30` |
| BUG-27 | Low | Dead controls: "Workspace Settings", the "+" in the REPOSITORIES heading, the Issues nav count fixed at "—", and External deps "View details" (`console.log`). | Click them | `Sidebar.tsx:170, 187, 272-275`, `DependenciesPanel.tsx:382` |
| BUG-28 | Low | Sidebar GitHub import uses `window.prompt`, inconsistent with the inline form on the welcome screen. URLs like `.../tree/main` are rejected instead of normalized. | Sidebar → Import from GitHub | `Sidebar.tsx:96-102`, `file_handler.py:178` |
| BUG-29 | Low | File-tree search flattens matches out of their folders, and folders that match don't show their children unless expanded. | Type `app` in Find a file | `FileExplorer.tsx:392-401` |
| BUG-30 | Low | The page title is "frontend". The favicon is the Vite template's. | Browser tab | `frontend/index.html:7` |
| BUG-31 | Low | Python inheritance edges are never produced (`bases` computed then discarded; `_extract_inheritance_edges` is `pass`). | n/a | `python_parser.py:154-160, 403-409` |
| BUG-32 | Low | Semgrep findings are all labelled `category: "Security"`, even though `p/default` includes correctness rules. Ruff `F401` unused imports are labelled "Medium". | n/a | `utils/semgrep_analyzer.py:73`, `utils/ruff_analyzer.py:58-60` |

---

## 6. Security Findings

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| SEC-01 | High | **A `.env` with `GROQ_API_KEY` is in the project tree.** It is gitignored, but this folder looks like a GitHub archive download (`CodeLens-AI-main`), which would mean it was committed at some point. Groq returns 401 for the key now (revoked?). Rotate it regardless and purge it from git history if it was ever pushed. | `.env:1`; `pytest` → 401 Invalid API Key |
| SEC-02 | High | **No authentication or authorization on any endpoint.** Anyone who can reach the port can list, import, delete and analyze repos and spend your Groq quota. Fine for localhost-only use, dangerous if run with `--host 0.0.0.0` or deployed. Simple cross-site `multipart/form-data` POSTs to `/upload` need no CORS preflight, so any web page you visit can push ZIPs to your local backend (CSRF disk filling). | `backend/main.py` (no auth dependency) |
| SEC-03 | Medium | **Unbounded ZIP entry count, and the GitHub clone has no size limit.** A 1.9 MB zip with 20,000 empty entries took **48.6 s** to import, blocking a worker. `git clone` has no size cap, so a huge repo can fill the disk. | `.review-scratch/fixtures/manyentries.zip`; `file_handler.py:115-156, 196-209` |
| SEC-04 | Medium | **Absolute server paths are leaked** to the API client in dependency `source_files`, and to the third-party LLM (`FILE: D:\Games\...\uploads\<uuid>\...`). This exposes the machine username and directory layout. | `.review-scratch/deps.json`; `backend/routers/ai.py:90` |
| SEC-05 | Medium | **Prompt injection is unmitigated.** Untrusted repository content is concatenated straight into the prompt with no delimiters or system role. A README saying "ignore previous instructions…" controls the summary. Low impact today (text only), but it becomes serious once chat or tool use is added. | `prompts/prompts.py:30-32, 60-62`; `agents/*.py` |
| SEC-06 | Medium | **Whole repository content is sent to Groq automatically** on every repo selection, with no user consent and no opt-out. Users may upload proprietary code expecting local-only analysis. Regex redaction is best-effort only: it catches `api_key=`, `password=`, GitHub/Google tokens and PEM blocks, but not tokens assigned to arbitrarily named variables (e.g. `STRIPE = "sk_live_…"`), JWTs, or connection strings like `postgres://user:pass@host`. | `WorkspacePanel.tsx:311-327`, `utils/security.py:42-88` |
| SEC-07 | Medium | **Git symlinks in cloned repos.** On Linux/macOS, `git clone` materialises symlinks. `get_code_files` lists file symlinks, and the summary path reads them with `open()` without a `resolve()` check. A repo containing `notes.md -> ~/.aws/credentials` would send that file to Groq. The content endpoint is protected (it resolves); the summary path is not. | `utils/file_handler.py:249-273`, `backend/routers/ai.py:84-90` |
| SEC-08 | Low | **Sensitive-file blocklist is narrow** (exact names only). `.npmrc`, `.pypirc`, `.aws/credentials`, `*.pem`, `*.key`, `secrets.yaml` and `id_ecdsa` can all be served by `/files/content` and sent to the LLM. | `utils/security.py:10-35` |
| SEC-09 | Low | **Error messages echo upstream and internal details** (`Groq API Error: Error code: 401 - {...}`, `Dependencies analysis failed: {e}`). | `backend/routers/ai.py:117, 176`; `dependencies.py:92` |
| SEC-10 | Low | **No rate limiting** on LLM endpoints. Combined with BUG-02, this means unbounded cost. | — |
| Audit | Info | `npm audit`: 0 vulnerabilities. `pip-audit` (all deps except Semgrep): 0 known vulnerabilities. Bandit on the project's own code: only Low findings (subprocess usage with list args, try/except/continue). Subprocess calls are injection-safe (argv lists, no `shell=True`). | Command output |

---

## 7. Performance Findings

| ID | Finding | Evidence | Fix direction |
|---|---|---|---|
| PERF-01 | Infinite summary loop (see BUG-02). Each iteration reads every repo file into one giant string. | 11 requests in 8 s | Fix the effect; don't auto-generate. |
| PERF-02 | **Exact betweenness centrality** on the full graph is O(V·E). It took **12.2 s of 16.4 s** for the 2,000-file repo, and it is used only to rank nodes for display. | cProfile: `graph_builder.py:122 calculate_centrality` | Use degree / PageRank, or `betweenness_centrality(k=100)` sampling. |
| PERF-03 | `get_call_graph()` rebuilds a subgraph **on every `get_fan_in`/`get_fan_out` call**: 8,402 rebuilds, 2.8 s. | cProfile: `graph_builder.py:76, 138, 143` | Build once and cache. |
| PERF-04 | No caching: every dependency endpoint re-parses the whole repo. The 5 endpoints are copy-pasted, so the full dependency view is a 22.6 s request, repeated on every visit or refresh, and it returns 2.8 MB of JSON. | `curl` timing; `backend/routers/dependencies.py` | Compute once per repo and persist like `analysis_results.json`; invalidate on re-import. |
| PERF-05 | Several O(n·m) loops: `next(n for n in nodes ...)` inside edge loops (`dependencies.py:231-233, 270`); `nodeCount` sums over all nodes per file (`dependencies.py:379`); `_find_containing_file` scans. | Code | Index nodes by id and by file once. |
| PERF-06 | `rglob` walks into `node_modules`/`.git` before filtering, once per extension (6 walks). | `backend/routers/dependencies.py:233-251` | Single `os.walk` with directory pruning (reuse `get_code_files`). |
| PERF-07 | `nx.simple_cycles` is fully materialised with `list(...)` before slicing to 20. Cycle count can be exponential on dense graphs. | `parser_factory.py:287`, `graph_builder.py:100` | `itertools.islice(nx.simple_cycles(G), 20)`, or use SCCs. |
| PERF-08 | Summary builds the entire repo into one string (up to 500 MB allowed) and then truncates to 30k chars. File order is alphabetical, so the README and entry points may be cut. | `backend/routers/ai.py:82-100` | Stream with a char budget; prioritise README, manifests and entry points. |
| PERF-09 | Long synchronous work (analysis ~5 s, dependencies ~20 s, import ~48 s) runs inside request handlers with no progress reporting. A single global analysis lock serialises all repos (the comment at `analysis_service.py:104-105` says the opposite). | Timing | Background jobs with status polling or SSE; a per-repo lock. |
| PERF-10 | Frontend: the file tree builds with `Array.find` per path segment (O(n²)) and renders every file without virtualisation. File preview renders one `<div>` per line (up to 1 MB files). `App.css` is 2,959 lines with 113 duplicated selectors. Bundle is fine at 86 KB gzip. | Code | Map-based tree, virtualised lists, CodeMirror/Monaco read-only viewer. |

---

## 8. UI/UX Findings

Screenshots are in `.review-scratch/screenshots/`.

**Visual design (desktop):** The base aesthetic is good. It uses a soft warm neutral background, restrained colour, consistent 8–12 px radii, Lucide icons, and a pleasant dark theme (`08-dark.png`). But:
- The **primary CTA is unstyled**: "Run Analysis" is a bare icon stacked over text (BUG-12). Spinner indicators are stacked the same way. This is the single most visible defect.
- The **Dependencies page is visually broken**: tabs render as concatenated text ("OverviewCircular (0)External (14)…") with icons on separate lines (`06-deps.png`, BUG-11).
- **Redundant chrome.** There are two breadcrumb bars (top toolbar "demo-repo / Workspace" plus workspace header "demo-repo > Project Overview"), and a page H1 repeats the same title. That is roughly 180 px of vertical space spent on navigation.
- **Information hierarchy is weak.** "Repository Health: Analyzed" is not a health metric. "File Types: 4" counts extensions (`.md` and `.json` are not languages). "Issues Found" tiles use orange for both Critical and High.
- **Inconsistent styling approaches.** There are inline `style={{…}}` objects (`AppShell.tsx:304-322`, `WorkspacePanel.tsx:613, 630, 642`), a Tailwind dependency that is barely used, and a 3,000-line global CSS file with duplicated rules.

**Responsiveness:**
- **Mobile (375 px) is unusable** (`11-mobile.png`). The sidebar takes about 50% of the width and the workspace is crushed. Stat-card labels wrap one letter per line ("S o u r c e F i l e s") and the header button is clipped. There is no drawer or off-canvas pattern.
- **Tablet (768 px)** is cramped (`11-tablet.png`). Three columns are forced side by side, the AI panel takes a third of the width, and "Analyzed" overflows its card.

**Accessibility** (axe-core plus manual checks):
- **color-contrast: 10 serious violations** on the Overview page.
- **landmark-unique**: duplicate `aside` landmarks without labels.
- **Delete modal** has no `role="dialog"`/`aria-modal`, does not move focus into the dialog, has no focus trap, and **Escape does not close it** (verified).
- Icon-only buttons rely on `title` (sidebar toggle, refresh, assistant collapse, "+"). The ✕ on the error banner has no accessible name at all.
- Errors and notices share one `role="status"` region. Errors should be `role="alert"`.
- Severity is colour-coded with text labels, which is good. The file tree has no `role="tree"`/`aria-expanded`. Collapsible sidebar sections lack `aria-expanded`.
- Keyboard order is logical and focus-visible styles exist (`index.css:50-52`), which is good. But the long sidebar makes reaching the workspace take 20+ tabs, and there is no "skip to content" link.

**Interaction quality:**
- Loading: there are spinners for analysis and summary but **no progress or ETA** for 5–50 s operations, and no cancel.
- Error states: AI failures are silent (BUG-17). Health is faked (BUG-18). Partial analyzer failure is reported as success (BUG-19).
- Empty states exist and are friendly, but **six sections** (Architecture, Data Flow, Performance, Documentation & Tests, Code Improvements, Reports) all show the same "will be connected in a later milestone" card (`07-placeholder.png`). Over half the navigation is promises.
- **Destructive action**: the delete confirmation exists, which is good, but it is not keyboard-friendly (see above).

**UX flow friction:**
1. First-run flow is decent (welcome card with ZIP/GitHub). The sidebar import, however, uses a native `prompt()`.
2. AI summary auto-runs and uploads your code to a third party without asking (SEC-06).
3. The AI Assistant panel permanently occupies ~300 px and does nothing (BUG-10). That is the worst kind of feature: visible, inviting, and fake.
4. There is no way to see *which* analyzers are missing, or to install or configure them from the UI (it is buried in "Analysis Details").
5. There is no deep linking or URL state (react-router is installed but unused). Refresh loses section, file and filter state.

**Versus best-in-class** (Sourcegraph/Cody, GitHub Code Search + Copilot Chat, CodeRabbit, Snyk Code, DeepSource):
- Those products give **grounded, cited answers** (file:line links), a **real code viewer** (syntax highlighting, symbols, go-to-definition), **interactive dependency graphs**, **trend over time** (scan history and diffing), **suppress / mark false positive**, **SARIF export**, and **PR integration**.
- CodeLens currently has none of these. Its differentiator (one local workspace combining multi-tool SAST with LLM explanations) is a good idea but not yet delivered.

---

## 9. Missing Features / Opportunities

**Must-have for credibility:**
- A real repository chat with retrieval: chunk, embed and retrieve, then answer with **file:line citations**.
- A working dependency graph: React Flow (`@xyflow/react`) plus ELK/dagre layout, folder clustering, and cycle highlighting.
- A syntax-highlighted code viewer (CodeMirror 6 read-only, or Shiki) with inline finding gutters.
- **AI "explain this finding / suggest fix"** per finding. This is the most natural bridge between the SAST and LLM halves.

**Differentiators:**
- Scan history plus a diff between runs ("3 new High since last scan").
- Health score derived from severity-weighted findings, complexity, cycles and test presence.
- Finding triage: mark false positive, accept risk, and group by rule or file.
- Export: SARIF, Markdown or PDF report. This is the "Reports" section, made real.
- Repo-wide complexity and hotspot heatmap (Lizard is already in `requirements.txt` but unused).
- Local-LLM option (Ollama) for privacy-sensitive code, plus a provider abstraction.
- Analyzer doctor: detect missing tools, show install commands, and offer Docker as the one-click path for Semgrep and Gitleaks on Windows.
- CLI/CI mode: `codelens scan .` producing JSON or SARIF, plus a GitHub Action.

---

## 10. The "Peak Project" Roadmap

Effort: **S** (< ½ day), **M** (1–3 days), **L** (1–2 weeks). Impact: **Low / Med / High**.

### Phase A: Fix critical bugs and stabilize

| # | Item | Effort | Impact | Files |
|---|---|---|---|---|
| A1 | Stop the summary retry loop. Make summary **opt-in** ("Generate summary" button) and reset AI state on repo/file change (BUG-02/03/04). | S | High | `WorkspacePanel.tsx` |
| A2 | Add `?force=true` to `POST /summary` so Regenerate actually regenerates (BUG-05). | S | Med | `backend/routers/ai.py`, `services/api.ts` |
| A3 | Surface AI and analysis errors in the UI. Real health check. Warn on partial analyzer failure (BUG-17/18/19). | S | High | `AppShell.tsx`, `WorkspacePanel.tsx` |
| A4 | Split requirements into `requirements.txt` (core) and optional `requirements-analyzers.txt`. Make Semgrep optional or WSL/Docker-only on Windows. Fix the README (BUG-01). | S | High | `requirements.txt`, `README.md` |
| A5 | Import hardening: max entry count, `BadZipFile` mapped to 400, skip invalid Windows names, reject repos with 0 source files, clean up workspace on failed clone, clone size limit (BUG-13/14/15/16, SEC-03). | M | High | `utils/file_handler.py`, `repository_service.py`, `routers/repositories.py` |
| A6 | Windows-safe delete (`onerror` handler that clears the read-only bit) plus an orphan workspace sweep (BUG-09/13). | S | Med | `repository_service.py` |
| A7 | Add base `.primary-button` styles and define `--accent-blue-rgb` (BUG-12). | S | High | `App.css` |
| A8 | Rotate the Groq key, add a root `.env.example`, and check git history for `.env` (SEC-01). | S | High | `.env.example` (new) |
| A9 | Anchor `UPLOAD_DIR` to a configurable absolute path (env var, default `<project>/uploads`) (BUG-23). | S | Med | `utils/file_handler.py` |
| A10 | Hide or "Coming soon"-label the AI chat and the 6 placeholder sections, and remove dead buttons (BUG-10/27), until they are real. | S | Med | `Sidebar.tsx`, `AIAssistant.tsx` |

### Phase B: Core functionality improvements

| # | Item | Effort | Impact | Files |
|---|---|---|---|---|
| B1 | **Rewrite import resolution:** keep module *and* names for Python `from` imports, handle parenthesised imports, resolve relative and absolute imports to repo files, resolve JS/TS relative paths with index/extension resolution, use a stdlib list (`sys.stdlib_module_names`) and Node builtins, keep scoped packages, and map import name to distribution (`yaml`→`pyyaml`). Build a **file-level** import graph and run cycles/SCCs on it (BUG-06/07/08/31). | L | High | `utils/code_graph/python_parser.py`, `javascript_parser.py`, `parser_factory.py`, `dependencies.py` |
| B2 | Compute dependencies once per repo, persist to `dependencies.json`, and collapse the 5 endpoints into 1 plus a sub-resource selector. Return repo-relative paths only (PERF-04, SEC-04). | M | High | `backend/routers/dependencies.py`, new `backend/services/dependency_service.py` |
| B3 | Background job runner for import/analysis/dependencies with status endpoint and progress; per-repo locks (PERF-09). | M | High | `backend/services/*`, new `backend/jobs.py`, frontend polling |
| B4 | **Real repository chat:** chunking, embeddings (local or Groq-compatible), retrieval, cited answers, system prompt with delimited untrusted content, conversation state (BUG-10, SEC-05). | L | High | `backend/routers/chat.py`, new `agents/chat_agent.py`, `AIAssistant.tsx` |
| B5 | "Explain this finding" and "Suggest fix" actions on each finding. | M | High | `routers/ai.py`, `prompts/prompts.py`, `WorkspacePanel.tsx` |
| B6 | Privacy controls: explicit consent before sending code to an LLM, a provider setting (Groq / Ollama / off), broader secret redaction and sensitive-file globs, symlink-safe reads (SEC-06/07/08). | M | High | `utils/security.py`, `utils/llm.py`, `routers/ai.py`, Settings UI |
| B7 | Optional API token or localhost-only binding guard, plus basic rate limiting on LLM routes (SEC-02/10). | S | Med | `backend/main.py` |
| B8 | Analyzer doctor endpoint (installed? version?) plus a Docker Compose setup bundling Semgrep and Gitleaks. | M | Med | new `backend/routers/system.py`, `docker-compose.yml` |
| B9 | Decide the fate of the Streamlit `app.py` (delete) and the empty `chat.py`/`files.py`. Remove `streamlit` from requirements. | S | Low | `app.py`, `requirements.txt` |

### Phase C: UI/UX overhaul

**Design direction (proposed):** a *calm, dense, developer-tool* aesthetic in the vein of Linear, Vercel and Sourcegraph:
- Neutral greys with **one** accent (indigo) and semantic severity colours (Critical red-600, High orange-600, Medium amber-500, Low sky-600, Info slate). All must meet WCAG AA at 4.5:1.
- Inter for UI, JetBrains Mono for code. An 8 px spacing scale, 6/10 px radii.
- Light and dark from a single token set, respecting the system preference and persisted.

| # | Item | Effort | Impact | Files |
|---|---|---|---|---|
| C1 | **Design system foundation:** CSS custom-property tokens (colour, space, radius, type, shadow) for light and dark. Delete the duplicated `App.css` and migrate to Tailwind v4 `@theme` tokens (Tailwind is already installed). Add a small primitive set: `Button` (primary/secondary/ghost/danger, sizes, loading), `IconButton` (required `aria-label`), `Badge`/`SeverityBadge`, `Card`, `StatTile`, `Tabs` (ARIA tabs), `Dialog` (focus trap, Esc, `role=dialog`), `Toast` (replacing the inline banner, `role=alert` for errors), `EmptyState`, `Skeleton`, `Tooltip`. Consider Radix primitives for Dialog/Tabs/Tooltip. | L | High | `frontend/src/components/ui/*` (new), `App.css`, `index.css` |
| C2 | **Layout:** one header (breadcrumb, repo switcher, health, theme), collapsible left nav, AI assistant as a toggleable right drawer (closed by default). Below 1024 px the nav becomes an off-canvas drawer; below 768 px single column with a bottom sheet for the assistant. | M | High | `AppShell.tsx`, `Sidebar.tsx` |
| C3 | **Routing and URL state** with react-router (already a dependency): `/repo/:id/overview`, `/issues?severity=High&q=…`, `/files/*path#L42`. | M | Med | `App.tsx`, `AppShell.tsx` |
| C4 | Split `WorkspacePanel.tsx` (976 lines) into `OverviewPage`, `IssuesPage`, `FilePreviewPage`, `DependenciesPage`, plus `useRepository`/`useAnalysis` hooks, or TanStack Query for fetching, caching, cancellation and retry with backoff. | M | High | `components/layout/WorkspacePanel.tsx` → `pages/*` |
| C5 | **Code viewer:** CodeMirror 6 read-only with syntax highlighting, line anchors, finding gutter markers, and "Explain selection". | M | High | new `components/code/CodeViewer.tsx` |
| C6 | **Dependency graph:** `@xyflow/react` + `elkjs` layout, folder grouping, cycle edges in red, click-to-focus, search; plus a sortable table view. | L | High | `DependenciesPanel.tsx` |
| C7 | **Overview redesign:** a real health score with breakdown, language bar (by language, not extension), top risky files, recent scan delta, and a summary card with opt-in Generate and a provider badge. | M | Med | `pages/OverviewPage.tsx` |
| C8 | **Issues upgrades:** group by file/rule, triage states, bulk actions, keyboard navigation (j/k), "Explain/Fix with AI", export. | M | High | `pages/IssuesPage.tsx` |
| C9 | **Accessibility pass:** fix the 10 contrast violations, labelled landmarks, tree semantics for the explorer, `aria-expanded` on collapsibles, skip link, visible focus everywhere, `prefers-reduced-motion`. Target 0 axe violations. | M | High | all components |
| C10 | **Import flow:** a single modal with tabs (ZIP drag-and-drop / GitHub URL accepting `/tree/branch` URLs), validation inline, progress steps (Uploading → Extracting → Indexing). | M | Med | new `components/import/ImportDialog.tsx` |
| C11 | Branding: page title, favicon, logo mark; remove unused Vite template assets (`hero.png`, `react.svg`, `vite.svg`, `icons.svg`). | S | Low | `index.html`, `public/`, `src/assets/` |

### Phase D: Performance, testing, docs and polish

| # | Item | Effort | Impact | Files |
|---|---|---|---|---|
| D1 | Graph performance: drop exact betweenness (use degree/PageRank or sampled), cache subgraphs, index nodes, `islice` cycles, single pruned walk (PERF-02/03/05/06/07). Target < 2 s for 2,000 files. | M | High | `utils/code_graph/graph_builder.py`, `dependencies.py`, `routers/dependencies.py` |
| D2 | **Backend tests (pytest):** unit tests for zip extraction (slip, symlink, bomb, invalid names), GitHub URL validation, path traversal, redaction, normalizer/dedup, severity, the import parsers on fixture repos (cycles, stdlib, scoped packages); API tests with `TestClient`; LLM mocked. Move fixtures to `tests/fixtures/`. Target ≥ 80% coverage on `utils/` and `backend/`. | L | High | `tests/**` |
| D3 | **Frontend tests:** Vitest + React Testing Library for state bugs (repo switch resets AI state, file switch resets explanation, no retry loop), MSW for API mocks; Playwright smoke test plus `@axe-core/playwright`. | M | High | `frontend/src/**/*.test.tsx`, `frontend/e2e/` |
| D4 | CI (GitHub Actions): ruff, pytest, eslint, `tsc`, vitest, Playwright, `npm audit`/`pip-audit`, on Ubuntu and Windows. | S | High | `.github/workflows/ci.yml` |
| D5 | Lint hygiene: fix the 13 ESLint errors (remove `any`, effect patterns), the 31 unused imports/variables, and add a `pyproject.toml` with ruff config. Pin Python deps (none are pinned today). | S | Med | various, `pyproject.toml` |
| D6 | Logging: structured logging (`logging` with request id), log analyzer stderr and LLM failures server-side; never return raw exception strings (SEC-09). | S | Med | `backend/main.py`, routers |
| D7 | Docs: accurate structure, Windows/WSL/Docker install paths, `.env.example`, full API table, architecture diagram, screenshots/GIF, CONTRIBUTING, LICENSE, a SECURITY note on what is sent to the LLM. | M | Med | `README.md`, `docs/`, `LICENSE` |
| D8 | Large-repo UX: virtualised file tree and findings list, Map-based tree build (PERF-10). | S | Med | `FileExplorer.tsx`, `IssuesPage.tsx` |

**Suggested order:** A1–A10 → D2/D3 (lock behaviour in with tests) → B1–B3 → C1–C4 → B4–B6 → C5–C11 → D1, D4–D8.

---

## 11. Questions for You

1. **Who is this for and how will it run?** A local single-user tool (keep auth minimal, localhost only), or a hosted multi-user service (needs auth, a job queue, storage, and stronger sandboxing of analyzers and clones)? This changes Phase B substantially.
2. **LLM policy:** should code ever leave the machine by default? Options: (a) opt-in per repo with Groq, (b) default to a local model (Ollama) with Groq optional, (c) keep Groq-only. And is `openai/gpt-oss-120b` on Groq the model you want to standardise on?
3. **Windows support:** is native Windows a must? If yes, do you accept Docker (or WSL) as the supported way to get Semgrep and Gitleaks, with Ruff and Bandit-only as the native fallback?
4. **Scope cut:** of the 6 placeholder sections (Architecture, Data Flow, Performance, Documentation & Tests, Code Improvements, Reports), which do you actually want to build? My recommendation is to keep **Dependencies (as Architecture)**, **Issues**, **Reports (export)**, and **AI chat**, and to cut or hide the rest until they are real.
5. **Legacy Streamlit `app.py`:** OK to delete it along with the `streamlit` dependency?
6. **Design direction:** are you happy with the proposed calm, dense dev-tool look (Linear/Sourcegraph-like, indigo accent, Tailwind tokens and Radix primitives)? Or do you want a more distinctive brand? Any colours or logo you want kept?
7. **Frontend data layer:** OK to add TanStack Query, `@xyflow/react` + `elkjs`, CodeMirror 6 and Radix? This adds roughly 150–200 KB gzip in total, mostly lazy-loaded per page.
8. **The `.env` key:** was this folder downloaded from GitHub, meaning `.env` is committed? If so, do you want help purging it from history (that is a force-push decision only you can make)?
9. **Language coverage:** beyond Python and JS/TS, which languages matter for dependency analysis? Go and Java are listed as "supported extensions" but have no parsers.
10. **Phase 2 working style:** a new branch named e.g. `review/phase-2`, with one PR per roadmap phase, or a single long-running branch? Note: this folder is **not currently a git repository**, so I'd need to `git init` (or you point me at the real clone) before Phase 2.

---

### Appendix: Key Command Output

```
npm run build   → ✓ built (dist/assets/index-*.js 286.37 kB │ gzip 86.17 kB)
npm run lint    → ✖ 13 problems (13 errors): 3× react-hooks/set-state-in-effect, 10× no-explicit-any
npm audit       → found 0 vulnerabilities
npm outdated    → typescript 6.0.3 (latest 7.0.2), @types/node 24 (26), lucide-react, react-router-dom (patch)
pip install -r requirements.txt → ERROR: Failed to build 'semgrep' … "Semgrep does not support Windows yet"
pip-audit (excl. semgrep) → No known vulnerabilities found
pytest          → ERROR collecting tests/test_llm.py … 401 Invalid API Key (1 error, 0 tests)
ruff (project)  → 343 findings with Ruff 0.17 defaults; 31 are F401/F841 unused imports/variables
POST /analyze ×4 concurrently → 409 409 409 200
GET /dependencies (2,000 files) → 200 in 22.6 s, 2.8 MB; cProfile: 12.2 s betweenness_centrality, 8,402× get_call_graph
POST /upload manyentries.zip (20k entries, 1.9 MB) → 200 in 48.6 s
DELETE GitHub-cloned repo → 500 "Unable to delete the repository workspace."
Overview idle 8 s with failing LLM → 11× POST /summary
axe-core (Overview) → serious color-contrast ×10, moderate landmark-unique ×1
```

Reproduction assets: `.review-scratch/make_fixtures.py` (fixture generator), `.review-scratch/fixtures/*.zip`, `.review-scratch/ui1.js` / `ui2.js` (Playwright + Edge scripts; they need `playwright-core` and `axe-core` installed next to them), and `.review-scratch/screenshots/`.
