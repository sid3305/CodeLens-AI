import type {
  AnalysisResponse,
  CircularDependency,
  DependenciesAnalysisResponse,
  DependenciesGraphData,
  DependenciesStats,
  ExplainResponse,
  ExternalDependency,
  Repository,
  RepositoryFilesResponse,
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

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
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

export const api = {
  health: () =>
    request<{ status: string }>('/health'),

  getRepositories: () =>
    request<Repository[]>('/repositories'),

  uploadRepository: async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    return request<Repository>('/repositories/upload', {
      method: 'POST',
      body: formData,
    })
  },

  importGitHub: (repoUrl: string) =>
    request<Repository>('/repositories/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: repoUrl }),
    }),

  getFiles: (repoId: string) =>
    request<RepositoryFilesResponse>(
      `/repositories/${encodeURIComponent(repoId)}/files`,
    ),

  getFileContent: (repoId: string, path: string) =>
    request<{ repository_id: string; path: string; content: string }>(
      `/repositories/${encodeURIComponent(repoId)}/files/content?path=${encodeURIComponent(path)}`,
    ),

  analyzeRepository: (repoId: string) =>
    request<AnalysisResponse>(
      `/repositories/${encodeURIComponent(repoId)}/analyze`,
      { method: 'POST' },
    ),

  getAnalysisResults: (repoId: string) =>
    request<AnalysisResponse>(
      `/repositories/${encodeURIComponent(repoId)}/results`,
    ),
  
  deleteRepository: (repoId: string) =>
  request<{ message: string; repository_id: string }>(
    `/repositories/${encodeURIComponent(repoId)}`,
    { method: 'DELETE' },
  ),

  /** Previously generated summary, or null if none exists. Never calls the LLM. */
  getSummary: async (repoId: string): Promise<SummaryResponse | null> => {
    try {
      return await request<SummaryResponse>(
        `/repositories/${encodeURIComponent(repoId)}/summary`,
      )
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  },

  generateSummary: (repoId: string, options: { force?: boolean } = {}) =>
    request<SummaryResponse>(
      `/repositories/${encodeURIComponent(repoId)}/summary${options.force ? '?force=true' : ''}`,
      { method: 'POST' },
    ),

  explainFile: (repoId: string, filePath: string) =>
    request<ExplainResponse>(
      `/repositories/${encodeURIComponent(repoId)}/files/explain`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: filePath }),
      },
    ),

  getDependenciesAnalysis: (repoId: string, maxNodes = 200) =>
    request<DependenciesAnalysisResponse>(
      `/repositories/${encodeURIComponent(repoId)}/dependencies?max_nodes=${maxNodes}`,
    ),

  getCircularDependencies: (repoId: string) =>
    request<{ repository_id: string; circular_dependencies: CircularDependency[]; count: number }>(
      `/repositories/${encodeURIComponent(repoId)}/dependencies/circular`,
    ),

  getExternalDependencies: (repoId: string) =>
    request<{ repository_id: string; external_dependencies: ExternalDependency[]; count: number }>(
      `/repositories/${encodeURIComponent(repoId)}/dependencies/external`,
    ),

  getModuleDependencyGraph: (repoId: string) =>
    request<{ repository_id: string; module_graph: DependenciesGraphData['moduleGraph']; module_count: number; dependency_count: number }>(
      `/repositories/${encodeURIComponent(repoId)}/dependencies/module-graph`,
    ),

  getDependenciesStats: (repoId: string) =>
    request<{ repository_id: string; stats: DependenciesStats }>(
      `/repositories/${encodeURIComponent(repoId)}/dependencies/stats`,
    ),
}
