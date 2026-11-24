
/** Sections with a real implementation. File preview is reached via the explorer. */
export type WorkspaceSection =
  | 'overview'
  | 'architecture'
  | 'issues'
  | 'chat'
  | 'file-preview'

/** Shapes returned by the backend API. This file is the single source of truth. */

export interface Repository {
  id: string
  name: string
  source: 'zip' | 'github'
  file_count: number
  created_at: string
  /** Branch, tag or commit a link import pointed at. */
  ref?: string | null
  /** Folder or file the link pointed at, opened after import. */
  focus_path?: string | null
  source_url?: string | null
  /** B6: AI allowed for this repository (off by default). */
  ai_consent?: boolean
}

/** Normalised form of a pasted repository link (no clone performed). */
export interface RepositoryLinkPreview {
  host: string
  owner: string
  repo: string
  ref: string | null
  ref_kind: 'branch' | 'commit' | null
  focus_path: string | null
  display: string
  url: string
}

/** What an AI task would send, counted by the backend without sending it. */
export interface AiEstimate {
  input_tokens: number
  output_tokens: number
  max_input_tokens: number
  within_budget: boolean
}

export interface AiEstimateQuery {
  task: 'summary' | 'explain' | 'finding'
  file_path?: string
  start_line?: number
  end_line?: number
}

export type FindingAiMode = 'explain' | 'fix'

/** B5: an AI explanation of, or fix for, one finding, and exactly what was sent. */
export interface FindingAiResponse {
  repository_id: string
  finding_id: string
  mode: FindingAiMode
  text: string
  generated_at: string
  sent: { file: string; start_line: number | null; end_line: number | null }
}

export type JobKind = 'import' | 'analysis' | 'dependencies'
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** B3: a background job; poll it until its status is final. */
export interface Job<Result = unknown> {
  id: string
  kind: JobKind
  repository_id: string | null
  status: JobStatus
  /** 0..1, or null when the step has no measurable progress. */
  progress: number | null
  message: string
  result: Result | null
  error: string | null
  created_at: string
  updated_at: string
}

/** B6: whether this repository's code may be sent to the AI provider, and who that is. */
export interface AiConsent {
  repository_id: string
  enabled: boolean
  provider: string
  model: string
  /** False until the provider is set up (e.g. GROQ_API_KEY). */
  configured: boolean
  problem: string | null
  /** Groq API keys in the pool (0 for other providers). */
  keys?: number
}

export interface ChatSource {
  file: string
  start_line: number
  end_line: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  /** Code excerpts sent with the question (assistant messages). */
  sources: ChatSource[]
  input_tokens: number | null
  cached: boolean
}

export interface ChatHistory {
  repository_id: string
  messages: ChatMessage[]
}

export interface ChatResponse {
  repository_id: string
  question: ChatMessage
  answer: ChatMessage
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
  /** Set when only some lines were explained (C5). */
  start_line?: number | null
  end_line?: number | null
  explanation: string
  generated_at: string
  truncated: boolean
}

/** A standard-library / Node.js built-in module and the files importing it. */
export interface StdlibImport {
  name: string
  language: string
  source_files: string[]
  import_count: number
}

export interface ExternalDependency {
  name: string
  source_files: string[]
  import_count: number
  language: string
  version: string | null
  is_dev_dependency: boolean
  /** Listed in a manifest (requirements*.txt, package.json, pyproject.toml). */
  declared?: boolean
}

export interface ModuleDependency {
  source_module: string
  target_module: string
  import_type: string
  imports: string[]
  edge_count: number
}

export interface CircularDependency {
  /** Files in import order; the last imports the first. */
  cycle: string[]
  /** Every file in the strongly connected component. */
  files?: string[]
  cycle_type: string
  severity: string
  description: string
}

export interface LanguageBreakdown {
  files: number
  internal_deps: number
  external_deps: number
}

/** Node in the React Flow format produced by the backend graph exporter. */
export interface GraphNode {
  id: string
  type: string
  data: Record<string, unknown>
  position: { x: number; y: number }
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type?: string
  data?: Record<string, unknown>
  animated?: boolean
  style?: Record<string, string | number>
}

export interface DependenciesGraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  totalNodes: number
  totalEdges: number
  showingNodes: number
  showingEdges: number
  folders: string[]
  moduleGraph?: {
    nodes: GraphNode[]
    edges: GraphEdge[]
  }
}

export interface UnresolvedImport {
  file: string
  line: number
  specifier: string
  language: string
  reason: string
}

export interface SkippedFile {
  path: string
  reason: string
}

export interface DependenciesStats {
  total_imports: number
  internal_imports?: number
  stdlib_imports?: number
  external_imports?: number
  unresolved_imports?: number
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
  stdlib_imports?: StdlibImport[]
  /** Every file the import analysis covered (never trimmed). */
  analyzed_files?: string[]
  unresolved_imports?: UnresolvedImport[]
  skipped_files?: SkippedFile[]
  dependency_graph_data: DependenciesGraphData
  language_breakdown: Record<string, LanguageBreakdown>
  stats: DependenciesStats
  generated_at: string
}
