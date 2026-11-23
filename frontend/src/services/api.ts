import type {
  AiConsent,
  AiEstimate,
  AiEstimateQuery,
  FindingAiMode,
  FindingAiResponse,
  Job,
  AnalysisResponse,
  DependenciesAnalysisResponse,
  ExplainResponse,
  Repository,
  RepositoryFilesResponse,
  RepositoryLinkPreview,
  SummaryResponse,
} from '../types'

// Re-exported so existing imports from the API module keep working.
export type * from '../types'

const API_BASE_URL = `${import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'}/api`

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, options)

  if (!response.ok) {
    let message = `Request failed (${response.status})`

    try {
      const error = await response.json()
      if (typeof error.detail === 'string') message = error.detail
    } catch {
      // Keep the default error message.
    }

    throw new ApiError(message, response.status)
  }

  return response.json() as Promise<T>
}

function postJson<T>(endpoint: string, body: unknown): Promise<T> {
  return request<T>(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const repo = (repoId: string) => `/repositories/${encodeURIComponent(repoId)}`

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  health: (signal?: AbortSignal) => request<{ status: string }>('/health', { signal }),

  getRepositories: (signal?: AbortSignal) => request<Repository[]>('/repositories', { signal }),

  /** Validate and normalise a repository link without importing it. */
  parseRepositoryLink: (repoUrl: string, signal?: AbortSignal) =>
    request<RepositoryLinkPreview>('/repositories/github/parse', { ...json({ repo_url: repoUrl }), signal }),

  deleteRepository: (repoId: string) =>
    request<{ message: string; repository_id: string }>(repo(repoId), { method: 'DELETE' }),

  getFiles: (repoId: string, signal?: AbortSignal) =>
    request<RepositoryFilesResponse>(`${repo(repoId)}/files`, { signal }),

  getFileContent: (repoId: string, path: string, signal?: AbortSignal) =>
    request<{ repository_id: string; path: string; content: string }>(
      `${repo(repoId)}/files/content?path=${encodeURIComponent(path)}`,
      { signal },
    ),

  /** Latest saved analysis, or null if none has been run. */
  getAnalysisResults: (repoId: string, signal?: AbortSignal) =>
    // null (200) until an analysis was run; 404 only for an unknown repository.
    request<AnalysisResponse | null>(`${repo(repoId)}/results`, { signal }),

  /** Previously generated summary, or null. Never calls the LLM. */
  // --- Background jobs (B3) ---

  listActiveJobs: (signal?: AbortSignal) => request<Job[]>('/jobs?active=true', { signal }),

  getJob: (jobId: string, signal?: AbortSignal) =>
    request<Job>(`/jobs/${encodeURIComponent(jobId)}`, { signal }),

  cancelJob: (jobId: string) =>
    request<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),

  startAnalysisJob: (repoId: string) => postJson<Job>('/jobs/analysis', { repository_id: repoId }),

  startDependenciesJob: (repoId: string, refresh = false) =>
    postJson<Job>('/jobs/dependencies', { repository_id: repoId, refresh }),

  startLinkImportJob: (url: string) => postJson<Job>('/jobs/import/link', { repo_url: url }),

  startZipImportJob: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<Job>('/jobs/import/zip', { method: 'POST', body })
  },

  /** The saved dependency report, or null if never computed (start a job). */
  getCachedDependencies: (repoId: string, signal?: AbortSignal) =>
    request<DependenciesAnalysisResponse | null>(`${repo(repoId)}/dependencies/cached`, { signal }),

  /** B5: sends one finding and a small redacted code window to the AI. */
  findingAi: (repoId: string, findingId: string, mode: FindingAiMode) =>
    postJson<FindingAiResponse>(`${repo(repoId)}/findings/${encodeURIComponent(findingId)}/ai`, { mode }),

  /** X3: the report file (never calls the AI). */
  exportReport: async (repoId: string, format: 'html' | 'json' | 'sarif', includeSummary: boolean) => {
    const query = new URLSearchParams({ format, include_summary: String(includeSummary) })
    const response = await fetch(`${API_BASE_URL}${repo(repoId)}/export?${query}`)
    if (!response.ok) throw new ApiError(`Export failed (${response.status})`, response.status)
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `codelens-report.${format}`
    return { blob: await response.blob(), filename }
  },

  /** Token counts of what a task would send (nothing is sent). */
  estimateAi: (repoId: string, query: AiEstimateQuery, signal?: AbortSignal) =>
    request<AiEstimate>(`${repo(repoId)}/ai/estimate`, { ...json(query), signal }),

  estimateFindings: (repoId: string, signal?: AbortSignal) =>
    request<{ output_tokens: number; max_input_tokens: number; findings: Record<string, number> }>(
      `${repo(repoId)}/ai/estimate/findings`,
      { signal },
    ),

  /** Written from the analysis facts with fixed sentences: no AI, no consent. */
  getStaticSummary: (repoId: string, signal?: AbortSignal) =>
    request<{ repository_id: string; markdown: string; generated_at: string }>(`${repo(repoId)}/static-summary`, { signal }),

  getAiConsent: (repoId: string, signal?: AbortSignal) =>
    request<AiConsent>(`${repo(repoId)}/ai-consent`, { signal }),

  setAiConsent: (repoId: string, enabled: boolean) =>
    request<AiConsent>(`${repo(repoId)}/ai-consent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),

  getSummary: (repoId: string, signal?: AbortSignal) =>
    // null (200) until a summary is generated; 404 only for an unknown repository.
    request<SummaryResponse | null>(`${repo(repoId)}/summary`, { signal }),

  /** Sends repository code to the LLM provider. */
  generateSummary: (repoId: string, options: { force?: boolean } = {}) =>
    request<SummaryResponse>(`${repo(repoId)}/summary${options.force ? '?force=true' : ''}`, { method: 'POST' }),

  /** Sends one file to the LLM provider. */
  /** `force` asks again instead of returning the saved answer (Regenerate). */
  explainFile: (repoId: string, filePath: string, force = false) =>
    request<ExplainResponse>(`${repo(repoId)}/files/explain`, json({ file_path: filePath, force })),

  /** C5: sends only lines start..end of the file to the AI. */
  explainSelection: (repoId: string, filePath: string, start: number, end: number) =>
    request<ExplainResponse>(
      `${repo(repoId)}/files/explain`,
      json({ file_path: filePath, start_line: start, end_line: end }),
    ),
}
