
/** Sections with a real implementation. File preview is reached via the explorer. */
export type WorkspaceSection =
  | 'overview'
  | 'architecture'
  | 'issues'
  | 'file-preview'

export interface RepositoryFile {
  name: string
  path: string
  extension?: string
  type?: 'file' | 'folder'
  children?: RepositoryFile[]
  language?: string
}

export interface Repository {
  id: string
  name: string
  source: string
  file_count?: number
  created_at?: string
  branch?: string
  status?: 'ready' | 'processing'
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
