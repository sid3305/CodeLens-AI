
const API_BASE_URL = 'http://127.0.0.1:8000/api'

export interface Repository {
  id: string
  name: string
  source: 'zip' | 'github'
  file_count: number
  created_at: string
}

export interface RepositoryFile {
  path: string
  name: string
  extension: string
}

export interface RepositoryFilesResponse {
  repository_id: string
  total_files: number
  files: RepositoryFile[]
}

export interface AnalyzerStatus {
  status: string
  findings: number
  error: string | null
}

export interface Finding {
  id: string
  title: string
  category: string
  severity: string
  confidence: string
  file: string
  line: number | null
  end_line: number | null
  column: number | null
  rule_id: string
  description: string
  recommendation: string
  detected_by: string[]
  duplicate_count?: number
  tool_details: {
    tool: string
    rule_id: string
    title: string
    description: string
    recommendation: string
    reference?: string | null
  }[]
}

export interface AnalysisSummary {
  total_findings: number
  raw_total_findings: number
  duplicates_removed: number
  severity_counts: Record<string, number>
  category_counts: Record<string, number>
  tool_counts: Record<string, number>
}

export interface AnalysisResponse {
  repository_id: string
  repository_name: string
  status: string
  analyzed_at: string
  summary: AnalysisSummary
  tool_status: Record<string, AnalyzerStatus>
  findings: Finding[]
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
      message = error.detail || message
    } catch {
      // Keep the default error message.
    }

    throw new Error(message)
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
}
