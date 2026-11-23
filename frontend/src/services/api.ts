import type {
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

/** A GET that resolves to null on 404 ("nothing there yet"). */
async function optional<T>(endpoint: string, signal?: AbortSignal): Promise<T | null> {
  try {
    return await request<T>(endpoint, { signal })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
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

  uploadRepository: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return request<Repository>('/repositories/upload', { method: 'POST', body: formData })
  },

  /** Validate and normalise a repository link without importing it. */
  parseRepositoryLink: (repoUrl: string, signal?: AbortSignal) =>
    request<RepositoryLinkPreview>('/repositories/github/parse', { ...json({ repo_url: repoUrl }), signal }),

  importGitHub: (repoUrl: string) =>
    request<Repository>('/repositories/github', json({ repo_url: repoUrl })),

  deleteRepository: (repoId: string) =>
    request<{ message: string; repository_id: string }>(repo(repoId), { method: 'DELETE' }),

  getFiles: (repoId: string, signal?: AbortSignal) =>
    request<RepositoryFilesResponse>(`${repo(repoId)}/files`, { signal }),

  getFileContent: (repoId: string, path: string, signal?: AbortSignal) =>
    request<{ repository_id: string; path: string; content: string }>(
      `${repo(repoId)}/files/content?path=${encodeURIComponent(path)}`,
      { signal },
    ),

  analyzeRepository: (repoId: string) =>
    request<AnalysisResponse>(`${repo(repoId)}/analyze`, { method: 'POST' }),

  /** Latest saved analysis, or null if none has been run. */
  getAnalysisResults: (repoId: string, signal?: AbortSignal) =>
    optional<AnalysisResponse>(`${repo(repoId)}/results`, signal),

  /** Previously generated summary, or null. Never calls the LLM. */
  getSummary: (repoId: string, signal?: AbortSignal) =>
    // null (200) until a summary is generated; 404 only for an unknown repository.
    request<SummaryResponse | null>(`${repo(repoId)}/summary`, { signal }),

  /** Sends repository code to the LLM provider. */
  generateSummary: (repoId: string, options: { force?: boolean } = {}) =>
    request<SummaryResponse>(`${repo(repoId)}/summary${options.force ? '?force=true' : ''}`, { method: 'POST' }),

  /** Sends one file to the LLM provider. */
  explainFile: (repoId: string, filePath: string) =>
    request<ExplainResponse>(`${repo(repoId)}/files/explain`, json({ file_path: filePath })),

  /** Cached on the server; `refresh` recomputes it. */
  getDependenciesAnalysis: (
    repoId: string,
    options: { refresh?: boolean; maxNodes?: number; signal?: AbortSignal } = {},
  ) => {
    const params = new URLSearchParams({ max_nodes: String(options.maxNodes ?? 200) })
    if (options.refresh) params.set('refresh', 'true')
    return request<DependenciesAnalysisResponse>(`${repo(repoId)}/dependencies?${params}`, {
      signal: options.signal,
    })
  },
}
