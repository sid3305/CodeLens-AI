
import {
  GitBranch,
  ChevronRight,
  FolderGit2,
  RefreshCw,
  ShieldCheck,
  Code2,
  Files,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileCode2,
  Upload,
  Search,
  ChevronDown,
  ExternalLink,
  SlidersHorizontal,
  Brain,
  Sparkles,
  Zap,
  Wand2,
} from 'lucide-react'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type {
  WorkspaceSection,
  Repository,
  RepositoryFile,
  AnalysisResponse,
  Finding,
  SummaryResponse,
} from '../../types'

import { api, errorMessage } from '../../services/api'
import DependenciesPanel from './DependenciesPanel'
import MarkdownContent from './MarkdownContent'
import { describeAnalysis } from '../../lib/analysis'

interface WorkspacePanelProps {
  activeSection: WorkspaceSection
  repository: Repository | null
  files: RepositoryFile[]
  analysis: AnalysisResponse | null
  selectedFilePath: string | null
  selectedFileContent: string | null
  onRunAnalysis: () => void
  analyzing: boolean
  onRefresh: () => void
  onImportZip: (file: File) => Promise<void>
  onImportGitHub: (url: string) => Promise<void>
  selectedLine: number | null
  onOpenFinding: (path: string, line: number | null) => void
}

interface SummaryState {
  repoId: string
  data: SummaryResponse | null
  error: string | null
}

interface ExplanationState {
  /** `${repositoryId}:${filePath}` */
  key: string
  text: string | null
  error: string | null
}

const sectionTitles: Record<WorkspaceSection, string> = {
  overview: 'Project Overview',
  architecture: 'Architecture',
  issues: 'Issues & Findings',
  'file-preview': 'File Preview',
}

function getLanguageCount(files: RepositoryFile[]) {
  return new Set(
    files
      .map((file) => file.extension?.toLowerCase() ?? '')
      .filter(Boolean),
  ).size
}

// Format AI-generated content with markdown-like parsing
function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: ReactNode
  label: string
  value: string
  color: string
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}


function FindingCard({
  finding,
  repositoryId,
  onOpenFinding,
}: {
  finding: Finding
  repositoryId: string
  onOpenFinding: (path: string, line: number | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [source, setSource] = useState<string | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)

  const loadSource = async () => {
    if (source !== null || sourceLoading) return

    setSourceLoading(true)
    setSourceError(null)

    try {
      const result = await api.getFileContent(repositoryId, finding.file)
      setSource(result.content)
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : 'Unable to load source code.',
      )
    } finally {
      setSourceLoading(false)
    }
  }

  const toggleSource = () => {
    const next = !expanded
    setExpanded(next)

    if (next) void loadSource()
  }

  const lines = source?.split('\n') ?? []
  const targetLine = finding.line
  let visibleLines: { number: number; content: string }[] = []

  if (targetLine && lines.length > 0) {
    const targetIndex = targetLine - 1
    const start = Math.max(0, Math.min(targetIndex - 5, lines.length - 12))
    const end = Math.min(lines.length, start + 12)

    visibleLines = lines.slice(start, end).map((content, index) => ({
      number: start + index + 1,
      content,
    }))
  }

  const severityClass = finding.severity.toLowerCase()

  return (
    <article className="finding-card">
      <div className="finding-card-header">
        <div className="finding-heading">
          <div className="finding-labels">
            <span className={`severity-badge ${severityClass}`}>
              {finding.severity}
            </span>
            <span className="finding-category">{finding.category}</span>
          </div>

          <h3>{finding.title}</h3>

          <span className="finding-rule">
            Rule: {finding.rule_id || 'Not specified'}
          </span>
        </div>
      </div>

      <p className="finding-description">{finding.description}</p>

      <button
        className="finding-location"
        onClick={() => onOpenFinding(finding.file, finding.line)}
        disabled={!finding.file}
        title="Open this location in File Preview"
      >
        <FileCode2 size={15} />
        <span>{finding.file}</span>
        <strong>{finding.line ? `:${finding.line}` : ''}</strong>
        <ExternalLink size={13} />
      </button>

      {finding.recommendation && (
        <div className="finding-recommendation">
          <strong>Recommended action</strong>
          <p>{finding.recommendation}</p>
        </div>
      )}

      <div className="finding-footer">
        <div className="finding-tools">
          {finding.detected_by.map((tool) => (
            <span key={tool}>{tool}</span>
          ))}
        </div>

        {finding.duplicate_count && finding.duplicate_count > 1 && (
          <span className="finding-duplicate">
            {finding.duplicate_count} detections
          </span>
        )}
      </div>

      <button
        className="source-toggle"
        onClick={toggleSource}
        aria-expanded={expanded}
      >
        <Code2 size={15} />
        {expanded ? 'Hide source context' : 'View source context'}
        <ChevronDown
          size={16}
          className={expanded ? 'source-chevron expanded' : 'source-chevron'}
        />
      </button>

      {expanded && (
        <div className="finding-source">
          {sourceLoading ? (
            <p className="source-message">Loading source code...</p>
          ) : sourceError ? (
            <p className="source-message source-error">{sourceError}</p>
          ) : !targetLine ? (
            <p className="source-message">
              No source line was provided for this finding.
            </p>
          ) : source !== null ? (
            <>
              <div className="source-context-header">
                <span>
                  Lines {visibleLines[0]?.number}–{visibleLines[visibleLines.length - 1]?.number}
                </span>
                <button
                  onClick={() => onOpenFinding(finding.file, finding.line)}
                >
                  Open full file <ExternalLink size={13} />
                </button>
              </div>

              <pre className="source-code">
                {visibleLines.map((line) => (
                  <div
                    key={line.number}
                    className={
                      line.number === targetLine
                        ? 'source-line source-line-highlighted'
                        : 'source-line'
                    }
                    id={`source-line-${finding.id}-${line.number}`}
                  >
                    <span className="source-line-number">{line.number}</span>
                    <code>{line.content || ' '}</code>
                  </div>
                ))}
              </pre>
            </>
          ) : null}
        </div>
      )}
    </article>
  )
}


export default function WorkspacePanel({
  activeSection,
  repository,
  files,
  analysis,
  selectedFilePath,
  selectedFileContent,
  onRunAnalysis,
  analyzing,
  onRefresh,
  onImportZip,
  onImportGitHub,
  selectedLine,
  onOpenFinding,
}: WorkspacePanelProps) {
  const zipInputRef = useRef<HTMLInputElement>(null)
  const selectedLineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeSection === 'file-preview' && selectedLine !== null) {
      selectedLineRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    } 
  }, [activeSection, selectedLine, selectedFileContent])

  const [githubUrl, setGithubUrl] = useState('')
  const [showGithubInput, setShowGithubInput] = useState(false)
  const [findingSearch, setFindingSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('All')
  const [analyzerFilter, setAnalyzerFilter] = useState('All')
  const repositoryId = repository?.id ?? null

  // AI results are stored together with the repository/file they belong to.
  // Rendering only uses a result whose key matches what is currently shown,
  // so a stale result can never be displayed for another repository or file.
  const [summaryState, setSummaryState] = useState<SummaryState | null>(null)
  const [generatingSummaryFor, setGeneratingSummaryFor] = useState<string | null>(null)
  const [explanationState, setExplanationState] = useState<ExplanationState | null>(null)
  const [explainingKey, setExplainingKey] = useState<string | null>(null)

  // Load an existing summary only. Generating one sends repository code to the
  // LLM provider, so it happens exclusively on an explicit user action.
  useEffect(() => {
    if (!repositoryId) return

    let cancelled = false

    api.getSummary(repositoryId).then(
      (data) => {
        if (!cancelled) setSummaryState({ repoId: repositoryId, data, error: null })
      },
      (error: unknown) => {
        if (!cancelled) {
          setSummaryState({
            repoId: repositoryId,
            data: null,
            error: errorMessage(error, 'Unable to load the saved summary.'),
          })
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [repositoryId])

  const currentSummary =
    summaryState && summaryState.repoId === repositoryId ? summaryState : null
  const aiSummary = currentSummary?.data ?? null
  const summaryError = currentSummary?.error ?? null
  const generatingSummary =
    repositoryId !== null && generatingSummaryFor === repositoryId

  const handleGenerateSummary = async (force = false) => {
    if (!repositoryId) return

    const targetId = repositoryId
    setGeneratingSummaryFor(targetId)

    try {
      const data = await api.generateSummary(targetId, { force })
      setSummaryState({ repoId: targetId, data, error: null })
    } catch (error) {
      setSummaryState((previous) => ({
        repoId: targetId,
        data: previous?.repoId === targetId ? previous.data : null,
        error: errorMessage(error, 'Failed to generate the summary.'),
      }))
    } finally {
      setGeneratingSummaryFor((current) => (current === targetId ? null : current))
    }
  }

  const fileKey =
    repositoryId && selectedFilePath ? `${repositoryId}:${selectedFilePath}` : null
  const currentExplanation =
    explanationState && explanationState.key === fileKey ? explanationState : null
  const fileExplanation = currentExplanation?.text ?? null
  const explainingFile = fileKey !== null && explainingKey === fileKey

  const handleGitHubImport = async () => {
    if (!githubUrl.trim()) return

    await onImportGitHub(githubUrl.trim())
    setGithubUrl('')
    setShowGithubInput(false)
  }

  const handleExplainFile = async () => {
    if (!repositoryId || !selectedFilePath || !fileKey) return

    const targetKey = fileKey
    setExplainingKey(targetKey)

    try {
      const response = await api.explainFile(repositoryId, selectedFilePath)
      setExplanationState({ key: targetKey, text: response.explanation, error: null })
    } catch (error) {
      setExplanationState({
        key: targetKey,
        text: null,
        error: errorMessage(error, 'Failed to explain this file.'),
      })
    } finally {
      setExplainingKey((current) => (current === targetKey ? null : current))
    }
  }

  const isOverview = activeSection === 'overview'
  const isIssues = activeSection === 'issues'
  const isFilePreview = activeSection === 'file-preview'
  const isArchitecture = activeSection === 'architecture'

  const findings = analysis?.findings ?? []
  const analysisOutcome = analysis ? describeAnalysis(analysis) : null
  const severityCounts = analysis?.summary.severity_counts ?? {}

  const severities = ['All', ...new Set(findings.map((f) => f.severity))]

const analyzers = [
  'All',
  ...new Set(findings.flatMap((finding) => finding.detected_by)),
]

const filteredFindings = findings.filter((finding) => {
  const query = findingSearch.toLowerCase()

  const matchesSearch =
    finding.title.toLowerCase().includes(query) ||
    finding.file.toLowerCase().includes(query) ||
    finding.rule_id.toLowerCase().includes(query) ||
    finding.description.toLowerCase().includes(query)

  const matchesSeverity =
    severityFilter === 'All' || finding.severity === severityFilter

  const matchesAnalyzer =
    analyzerFilter === 'All' ||
    finding.detected_by.includes(analyzerFilter)

  return matchesSearch && matchesSeverity && matchesAnalyzer
})

  const criticalCount = severityCounts.Critical ?? 0
  const highCount = severityCounts.High ?? 0
  const mediumCount = severityCounts.Medium ?? 0
  const lowCount = severityCounts.Low ?? 0

  return (
    <main className="workspace-panel">
      <header className="workspace-header">
        <div className="breadcrumb">
          <FolderGit2 size={16} />
          <span>{repository?.name ?? 'No repository selected'}</span>
          <ChevronRight size={14} />
          <strong>{sectionTitles[activeSection]}</strong>
        </div>

        <div className="workspace-header-actions">
          <span className="branch-indicator">
            <GitBranch size={14} />
            {repository?.source.toUpperCase() ?? 'LOCAL'}
          </span>

          <button
            className="icon-button"
            title="Refresh repositories"
            onClick={onRefresh}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <div className="workspace-scroll">
        <div className="page-heading">
          <div>
            <div className="eyebrow">REPOSITORY WORKSPACE</div>
            <h1>{sectionTitles[activeSection]}</h1>
            <p>
              {repository
                ? `Explore ${repository.name} and its repository intelligence.`
                : 'Import a repository to get started with CodeLens AI.'}
            </p>
          </div>

          {repository && (
            <button
              className="primary-button run-analysis-btn"
              onClick={onRunAnalysis}
              disabled={analyzing}
            >
              {analyzing ? (
                <>
                  <RefreshCw size={16} className="spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Zap size={16} />
                  Run Analysis
                </>
              )}
            </button>
          )}
        </div>

        {!repository ? (
            <section className="content-section">
                <div className="empty-content repository-welcome">
                <FolderGit2 size={34} />

                <h3>Welcome to CodeLens AI</h3>

                <p>
                    Import a repository to explore its architecture,
                    analyze code quality, identify security issues and
                    understand your codebase with AI.
                </p>

                <input
                    ref={zipInputRef}
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    hidden
                    onChange={async (event) => {
                    const file = event.target.files?.[0]

                    if (file) {
                        await onImportZip(file)
                    }

                    event.target.value = ''
                    }}
                />

                <div className="welcome-actions">
                    <button
                    className="secondary-button"
                    onClick={() => zipInputRef.current?.click()}
                    >
                    <Upload size={16} />
                    Upload ZIP Repository
                    </button>

                    <button
                        className="secondary-button"
                        onClick={() => setShowGithubInput(!showGithubInput)}
                        >
                        <Code2 size={16} />
                        Import from GitHub
                    </button>
                </div>

                <span className="welcome-note">
                    Supports ZIP archives and public GitHub repositories
                    {showGithubInput && (
                    <div className="github-inline-form">
                        <input
                        type="url"
                        value={githubUrl}
                        onChange={(event) => setGithubUrl(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                            void handleGitHubImport()
                            }
                        }}
                        placeholder="https://github.com/owner/repository"
                        />

                        <button
                        className="primary-button"
                        onClick={() => void handleGitHubImport()}
                        disabled={!githubUrl.trim()}
                        >
                        Import Repository
                        </button>

                        <button
                        className="secondary-button"
                        onClick={() => {
                            setShowGithubInput(false)
                            setGithubUrl('')
                        }}
                        >
                        Cancel
                        </button>
                    </div>
                    )}
                </span>
                </div>
            </section>
            ) : isOverview ? (
          <>
            <div className="overview-stats">
              <StatCard
                icon={<Files />}
                label="Source Files"
                value={String(files.length)}
                color="blue"
              />

              <StatCard
                icon={<Code2 />}
                label="File Types"
                value={String(getLanguageCount(files))}
                color="teal"
              />

              <StatCard
                icon={<ShieldCheck />}
                label="Issues Found"
                value={analysis ? String(findings.length) : '—'}
                color="orange"
              />

              <StatCard
                icon={<Activity />}
                label="Analyzers run"
                value={
                  analysisOutcome
                    ? `${analysisOutcome.completedTools.length}/${
                        analysisOutcome.completedTools.length +
                        analysisOutcome.failedTools.length
                      }`
                    : '—'
                }
                color="blue"
              />
            </div>

            <section className="content-section">
              <div className="section-title-row">
                <div>
                  <h2>Project Summary</h2>
                  <p>AI-powered repository overview</p>
                </div>

                {generatingSummary && (
                  <span className="generating-indicator">
                    <RefreshCw size={14} className="spin" />
                    Generating AI summary...
                  </span>
                )}

                {aiSummary && (
                  <span className="generated-indicator">
                    <Sparkles size={14} />
                    Generated {new Date(aiSummary.generated_at).toLocaleTimeString()}
                    {aiSummary.truncated && ' · Truncated'}
                  </span>
                )}
              </div>

              {aiSummary ? (
                <div className="ai-summary-content">
                  <div className="ai-content-header">
                    <div className="icon">
                      <Brain size={18} />
                    </div>
                    <h3>AI Repository Summary</h3>
                    <span className="meta">
                      {aiSummary.truncated && 'Truncated'}
                    </span>
                  </div>
                  <div className="ai-summary-text">
                    <MarkdownContent content={aiSummary.summary} />
                  </div>
                  {summaryError && (
                    <p className="inline-error" role="alert">{summaryError}</p>
                  )}
                  <button
                    className="secondary-button regenerate-btn"
                    onClick={() => void handleGenerateSummary(true)}
                    disabled={generatingSummary}
                  >
                    <RefreshCw size={14} />
                    Regenerate Summary
                  </button>
                </div>
              ) : (
                <div className="empty-content">
                  <Brain size={25} />
                  <h3>No AI summary yet</h3>
                  <p>
                    Generating a summary sends up to 30,000 characters of this
                    repository&rsquo;s source code (secrets redacted) to the
                    configured AI provider.
                  </p>
                  {summaryError && (
                    <p className="inline-error" role="alert">{summaryError}</p>
                  )}
                  <button
                    className="secondary-button"
                    onClick={() => void handleGenerateSummary()}
                    disabled={generatingSummary}
                  >
                    <Sparkles size={16} />
                    Generate AI summary
                  </button>
                </div>
              )}
            </section>

            <section className="content-section">
              <div className="section-title-row">
                <div>
                  <h2>Analysis Summary</h2>
                  <p>Findings grouped by severity</p>
                </div>
              </div>

              {analysis ? (
                <div className="overview-stats">
                  <StatCard
                    icon={<AlertTriangle />}
                    label="Critical"
                    value={String(criticalCount)}
                    color="orange"
                  />
                  <StatCard
                    icon={<AlertTriangle />}
                    label="High"
                    value={String(highCount)}
                    color="orange"
                  />
                  <StatCard
                    icon={<Activity />}
                    label="Medium"
                    value={String(mediumCount)}
                    color="blue"
                  />
                  <StatCard
                    icon={<CheckCircle2 />}
                    label="Low"
                    value={String(lowCount)}
                    color="teal"
                  />
                </div>
              ) : (
                <div className="empty-content compact-empty">
                  Severity statistics will appear after analysis.
                </div>
              )}
            </section>
          </>
        
) : isIssues ? (
  <>
    <section className="issues-summary">
      <div className="issues-summary-heading">
        <div>
          <h2>Analysis Results</h2>
          <p>
            {analysis
              ? `${findings.length} consolidated findings`
              : 'Run analysis to discover repository issues.'}
          </p>
        </div>

        {analysisOutcome && (
          <span className={`analysis-completed ${analysisOutcome.tone}`}>
            {analysisOutcome.tone === 'success' ? (
              <CheckCircle2 size={14} />
            ) : (
              <AlertTriangle size={14} />
            )}
            {analysisOutcome.tone === 'success'
              ? 'Analysis completed'
              : analysisOutcome.tone === 'warning'
                ? `Partial: ${analysisOutcome.failedTools.join(', ')} not run`
                : 'Analysis failed'}
          </span>
        )}
      </div>

      {analysis && (
        <div className="issues-severity-grid">
          {[
            { label: 'Critical', value: criticalCount },
            { label: 'High', value: highCount },
            { label: 'Medium', value: mediumCount },
            { label: 'Low', value: lowCount },
          ].map((item) => (
            <div className={`issues-severity-item ${item.label.toLowerCase()}`} key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>

    {!analysis ? (
      <section className="content-section">
        <div className="empty-content">
          <AlertTriangle size={25} />
          <h3>No analysis results</h3>
          <p>Run Code Analysis to populate the findings list.</p>
        </div>
      </section>
    ) : (
      <>
        <section className="content-section issues-list-section">
          <div className="section-title-row">
            <div>
              <h2>Findings</h2>
              <p>
                Showing {filteredFindings.length} of {findings.length} findings
              </p>
            </div>
          </div>

          <div className="finding-filters">
            <div className="finding-search">
              <Search size={16} />
              <input
                value={findingSearch}
                onChange={(event) => setFindingSearch(event.target.value)}
                placeholder="Search findings, files or rules..."
              />
            </div>

            <div className="finding-filter-control">
              <SlidersHorizontal size={15} />
              <select
                value={severityFilter}
                onChange={(event) => setSeverityFilter(event.target.value)}
              >
                {severities.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity === 'All' ? 'All severities' : severity}
                  </option>
                ))}
              </select>
            </div>

            <div className="finding-filter-control">
              <select
                value={analyzerFilter}
                onChange={(event) => setAnalyzerFilter(event.target.value)}
              >
                {analyzers.map((analyzer) => (
                  <option key={analyzer} value={analyzer}>
                    {analyzer === 'All' ? 'All analyzers' : analyzer}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {findings.length === 0 ? (
            <div className="empty-content">
              <CheckCircle2 size={25} />
              <h3>No findings detected</h3>
              <p>The analyzers did not report any findings in this run.</p>
            </div>
          ) : filteredFindings.length === 0 ? (
            <div className="empty-content compact-empty">
              No findings match your search or filters.
            </div>
          ) : (
            <div className="findings-list">
              {filteredFindings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  repositoryId={repository.id}
                  onOpenFinding={onOpenFinding}
                />
              ))}
            </div>
          )}
        </section>

        <details className="analysis-details">
          <summary>
            <div>
              <strong>Analysis Details</strong>
              <span>Raw analyzer results and execution status</span>
            </div>
            <ChevronDown size={17} className="details-chevron" />
          </summary>

          <div className="analysis-details-content">
            <div className="analysis-details-note">
              Analyzer counts represent individual tool detections. They may
              overlap because multiple tools can report the same issue.
            </div>

            <div className="analyzer-table">
              {Object.entries(analysis.tool_status).map(([tool, status]) => (
                <div className="analyzer-row" key={tool}>
                  <div>
                    <strong>{tool}</strong>
                    {status.error && <p>{status.error}</p>}
                  </div>

                  <div className="analyzer-result">
                    {status.status.toLowerCase() === 'completed' ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <XCircle size={15} />
                    )}
                    <span>{status.status}</span>
                    <strong>{status.findings} raw</strong>
                  </div>
                </div>
              ))}
            </div>

            <div className="analysis-total-row">
              <span>Raw detections</span>
              <strong>{analysis.summary.raw_total_findings}</strong>
              <span>Duplicates consolidated</span>
              <strong>{analysis.summary.duplicates_removed}</strong>
            </div>
          </div>
        </details>
      </>
    )}
  </>
        ) : isArchitecture ? (
          <DependenciesPanel
            repository={repository}
            onRefresh={onRefresh}
          />
        ) : isFilePreview && selectedFilePath ? (
  <section className="content-section">
    <div className="section-title-row">
      <div>
        <h2>
          <FileCode2 size={19} /> {selectedFilePath}
        </h2>
        <p>
          Repository file preview
          {selectedLine !== null && ` · Focused on line ${selectedLine}`}
        </p>
      </div>

      {repository && selectedFileContent && !fileExplanation && !explainingFile && (
        <button
          className="primary-button"
          onClick={handleExplainFile}
          disabled={explainingFile}
          style={{ marginLeft: 'auto' }}
        >
          <Sparkles size={16} />
          {explainingFile ? 'Explaining...' : 'Explain This File'}
        </button>
      )}

      {explainingFile && (
        <span className="coming-label">
          <RefreshCw size={14} className="spin" />
          Generating explanation...
        </span>
      )}

      {fileExplanation && (
        <span className="coming-label">
          <Sparkles size={14} />
          Explanation generated
        </span>
      )}
    </div>

    {currentExplanation?.error && (
      <p className="inline-error" role="alert">{currentExplanation.error}</p>
    )}

    {selectedFileContent === null ? (
      <div className="empty-content compact-empty">
        Loading file content...
      </div>
    ) : (
      <>
        <div className="file-preview-container">
          <pre className="file-preview-code">
            {selectedFileContent.split('\n').map((line, index) => {
              const lineNumber = index + 1
              const isSelected = lineNumber === selectedLine

              return (
                <div
                  key={lineNumber}
                  ref={isSelected ? selectedLineRef : null}
                  className={
                    isSelected
                      ? 'file-preview-line file-preview-line-highlighted'
                      : 'file-preview-line'
                  }
                >
                  <span className="file-preview-line-number">
                    {lineNumber}
                  </span>
                  <code>{line || ' '}</code>
                </div>
              )
            })}
          </pre>
        </div>

        {fileExplanation && (
          <div className="ai-explanation-section" style={{ marginTop: '24px' }}>
            <div className="ai-content-header">
              <div className="icon">
                <Wand2 size={18} />
              </div>
              <h3>AI File Explanation</h3>
              <span className="meta">{selectedFilePath}</span>
            </div>
            <div className="ai-explanation-content">
              <MarkdownContent content={fileExplanation} />
            </div>
            <button
              className="secondary-button regenerate-btn"
              onClick={handleExplainFile}
              style={{ marginTop: '16px' }}
            >
              <RefreshCw size={14} />
              Regenerate Explanation
            </button>
          </div>
        )}
      </>
    )}
  </section>
        ) : (
          <section className="content-section">
            <div className="empty-content">
              <FileCode2 size={25} />
              <h3>No file selected</h3>
              <p>Select a file in the explorer to preview it here.</p>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
