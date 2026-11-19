
export type WorkspaceSection =
  | 'overview'
  | 'architecture'
  | 'data-flow'
  | 'dependencies'
  | 'issues'
  | 'performance'
  | 'documentation'
  | 'code-improvements'
  | 'reports'
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
