import type { ReactNode } from 'react'
import { Activity, Brain, Code2, Files, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'

import type { AnalysisResponse, RepositoryFile, SummaryResponse } from '../../types'
import type { AnalysisOutcome } from '../../lib/analysis'
import MarkdownContent from '../layout/MarkdownContent'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  InlineMessage,
  LoadingBlock,
  SeverityBadge,
  StatTile,
} from '../ui'

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const

function countFileTypes(files: RepositoryFile[]) {
  return new Set(files.map((file) => file.extension.toLowerCase()).filter(Boolean)).size
}

export default function OverviewSection({
  files,
  analysis,
  outcome,
  summary,
  summaryError,
  generatingSummary,
  onGenerateSummary,
  aiAllowed,
  aiNotice,
  staticSummary,
}: {
  files: RepositoryFile[]
  analysis: AnalysisResponse | null
  outcome: AnalysisOutcome | null
  summary: SummaryResponse | null
  summaryError: string | null
  generatingSummary: boolean
  onGenerateSummary: (force: boolean) => void
  /** B6: AI may only run after the user allowed it for this repository. */
  aiAllowed: boolean
  /** What is sent and to which provider, with the consent control. */
  aiNotice: ReactNode
  /** Written from the analysis facts with fixed sentences: no AI. */
  staticSummary: string | null
}) {
  const counts = analysis?.summary.severity_counts ?? {}
  const analyzersRun = outcome
    ? `${outcome.completedTools.length}/${outcome.completedTools.length + outcome.failedTools.length}`
    : '—'

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatTile icon={<Files size={18} />} label="Source files" value={files.length} />
        <StatTile icon={<Code2 size={18} />} label="File types" value={countFileTypes(files)} />
        <StatTile
          icon={<ShieldCheck size={18} />}
          label="Issues found"
          value={analysis ? analysis.findings.length : '—'}
        />
        <StatTile icon={<Activity size={18} />} label="Analyzers run" value={analyzersRun} />
      </div>

      <Card aria-labelledby="summary-heading">
        <CardHeader
          titleId="summary-heading"
          title="Project summary"
          description="Written from the analysis, without AI"
          actions={
            summary ? (
              <Badge tone="accent" icon={<Sparkles size={12} aria-hidden="true" />}>
                Generated {new Date(summary.generated_at).toLocaleString()}
                {summary.truncated && ' · partial input'}
              </Badge>
            ) : undefined
          }
        />
        <CardBody>
          {staticSummary ? (
            <div className="prose-content">
              <MarkdownContent content={staticSummary} />
            </div>
          ) : (
            <LoadingBlock label="Loading the summary" lines={4} />
          )}
          <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2 text-sm font-semibold text-fg">AI summary (optional)</h3>
          {summary ? (
            <>
              <div className="prose-content">
                <MarkdownContent content={summary.summary} />
              </div>
              {summaryError && <InlineMessage tone="error" className="mt-3">{summaryError}</InlineMessage>}
              <div className="mt-4">{aiNotice}</div>
              <Button
                className="mt-3"
                icon={<RefreshCw size={14} aria-hidden="true" />}
                loading={generatingSummary}
                disabled={!aiAllowed}
                onClick={() => onGenerateSummary(true)}
              >
                Regenerate summary
              </Button>
            </>
          ) : (
            <EmptyState
              headingLevel={3}
              icon={<Brain size={22} />}
              title="No AI summary yet"
              description={
                <>
                  <div className="text-left">{aiNotice}</div>
                  {summaryError && <InlineMessage tone="error" className="mt-3">{summaryError}</InlineMessage>}
                </>
              }
              action={
                <Button
                  icon={<Sparkles size={14} aria-hidden="true" />}
                  loading={generatingSummary}
                  disabled={!aiAllowed}
                  onClick={() => onGenerateSummary(false)}
                >
                  Generate AI summary
                </Button>
              }
            />
          )}
          </div>
        </CardBody>
      </Card>

      <Card aria-labelledby="severity-heading">
        <CardHeader
          titleId="severity-heading"
          title="Findings by severity"
          description={
            outcome
              ? outcome.message
              : 'Run an analysis to check the repository with Ruff, Bandit and, if installed, Semgrep and Gitleaks.'
          }
        />
        <CardBody>
          {analysis ? (
            <ul className="flex flex-wrap gap-2" aria-label="Findings by severity">
              {SEVERITIES.map((severity) => (
                <li key={severity}>
                  <SeverityBadge severity={severity} count={counts[severity] ?? 0} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-fg-muted">No analysis has been run yet.</p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
