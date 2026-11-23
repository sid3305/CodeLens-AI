import { FolderGit2, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'

import type {
  AnalysisResponse,
  Repository,
  RepositoryFile,
  SummaryResponse,
  WorkspaceSection,
} from '../../types'

import { api, errorMessage } from '../../services/api'
import { describeAnalysis } from '../../lib/analysis'
import DependenciesPanel from './DependenciesPanel'
import ImportPanel from '../import/ImportPanel'
import FilePreviewSection from '../workspace/FilePreviewSection'
import IssuesSection from '../workspace/IssuesSection'
import type { FindingFilters } from '../workspace/findingFilters'
import OverviewSection from '../workspace/OverviewSection'
import { Button, Card, EmptyState } from '../ui'

interface WorkspacePanelProps {
  activeSection: WorkspaceSection
  repository: Repository | null
  files: RepositoryFile[]
  analysis: AnalysisResponse | null
  selectedFilePath: string | null
  selectedFileContent: string | null
  onRunAnalysis: () => void
  analyzing: boolean
  onImportZip: (file: File) => Promise<boolean | void>
  onImportGitHub: (url: string) => Promise<boolean | void>
  importing?: boolean
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

const SECTIONS: Record<WorkspaceSection, { title: string; description: string }> = {
  overview: { title: 'Overview', description: 'Repository statistics, AI summary and findings at a glance.' },
  architecture: { title: 'Architecture', description: 'How files depend on each other and on external packages.' },
  issues: { title: 'Issues', description: 'Findings from the static analyzers, merged across tools.' },
  'file-preview': { title: 'File preview', description: 'Read a file and ask the AI to explain it.' },
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
  onImportZip,
  onImportGitHub,
  importing = false,
  selectedLine,
  onOpenFinding,
}: WorkspacePanelProps) {
  const [filters, setFilters] = useState<FindingFilters>({ query: '', severity: 'All', analyzer: 'All' })
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


  const analysisOutcome = analysis ? describeAnalysis(analysis) : null

  if (!repository) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <Card>
          <EmptyState
            headingLevel={1}
            icon={<FolderGit2 size={24} />}
            title="Welcome to CodeLens AI"
            description="Import a repository to explore its structure, check it with static analyzers and understand it with AI."
          />
          <div className="px-4 pb-6 sm:px-6">
            <ImportPanel importing={importing} onImportLink={onImportGitHub} onImportZip={onImportZip} />
          </div>
        </Card>
      </div>
    )
  }

  const section = SECTIONS[activeSection]

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{section.title}</h1>
          <p className="mt-1 text-base text-fg-muted">{section.description}</p>
        </div>
        <Button
          variant="primary"
          icon={<Zap size={15} aria-hidden="true" />}
          loading={analyzing}
          onClick={onRunAnalysis}
        >
          {analyzing ? 'Analyzing…' : 'Run analysis'}
        </Button>
      </div>

      {activeSection === 'overview' && (
        <OverviewSection
          files={files}
          analysis={analysis}
          outcome={analysisOutcome}
          summary={aiSummary}
          summaryError={summaryError}
          generatingSummary={generatingSummary}
          onGenerateSummary={(force) => void handleGenerateSummary(force)}
        />
      )}

      {activeSection === 'issues' && (
        <IssuesSection
          analysis={analysis}
          outcome={analysisOutcome}
          repositoryId={repository.id}
          filters={filters}
          onFiltersChange={setFilters}
          onOpenFinding={onOpenFinding}
        />
      )}

      {activeSection === 'architecture' && <DependenciesPanel repository={repository} />}

      {activeSection === 'file-preview' && (
        <FilePreviewSection
          path={selectedFilePath}
          content={selectedFileContent}
          line={selectedLine}
          explanation={fileExplanation}
          explanationError={currentExplanation?.error ?? null}
          explaining={explainingFile}
          onExplain={() => void handleExplainFile()}
        />
      )}
    </div>
  )
}
