
const API_BASE_URL = `${import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'}/api`

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

export interface SummaryResponse {
  repository_id: string
  repository_name: string
  summary: string
  generated_at: string
  truncated: boolean
}

export interface ExplainResponse {
  repository_id: string
  file_path: string
  explanation: string
  generated_at: string
  truncated: boolean
}

export interface ExternalDependency {
  name: string
  source_files: string[]
  import_count: number
  language: string
  version: string | null
  is_dev_dependency: boolean
}

export interface ModuleDependency {
  source_module: string
  target_module: string
  import_type: string
  imports: string[]
  edge_count: number
}

export interface CircularDependency {
  cycle: string[]
  cycle_type: string
  severity: string
  description: string
}

export interface LanguageBreakdown {
  files: number
  internal_deps: number
  external_deps: number
}

export interface DependenciesGraphData {
  nodes: any[]
  edges: any[]
  totalNodes: number
  totalEdges: number
  showingNodes: number
  showingEdges: number
  folders: string[]
  moduleGraph?: {
    nodes: any[]
    edges: any[]
  }
}

export interface DependenciesStats {
  total_imports: number
  total_calls: number
  circular_import_count: number
  dead_code_count: number
  hotspot_count: number
  file_count: number
}

export interface DependenciesAnalysisResponse {
  repository_id: string
  total_internal_modules: number
  total_external_dependencies: number
  circular_dependencies: CircularDependency[]
  module_dependencies: ModuleDependency[]
  external_dependencies: ExternalDependency[]
  dependency_graph_data: DependenciesGraphData
  language_breakdown: Record<string, LanguageBreakdown>
  stats: DependenciesStats
  generated_at: string
}

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

  generateSummary: (repoId: string) =>
    request<SummaryResponse>(
      `/repositories/${encodeURIComponent(repoId)}/summary`,
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
