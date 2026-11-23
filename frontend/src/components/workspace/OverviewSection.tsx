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
}: {
  files: RepositoryFile[]
  analysis: AnalysisResponse | null
  outcome: AnalysisOutcome | null
  summary: SummaryResponse | null
  summaryError: string | null
  generatingSummary: boolean
  onGenerateSummary: (force: boolean) => void
}) {
  const counts = analysis?.summary.severity_counts ?? {}
  const analyzersRun = outcome
    ? `${outcome.completedTools.length}/${outcome.completedTools.length + outcome.failedTools.length}`
    : '—'

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
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
          description="AI-generated overview of what the repository does"
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
          {summary ? (
            <>
              <div className="prose-content">
                <MarkdownContent content={summary.summary} />
              </div>
              {summaryError && <InlineMessage tone="error" className="mt-3">{summaryError}</InlineMessage>}
              <Button
                className="mt-4"
                icon={<RefreshCw size={14} aria-hidden="true" />}
                loading={generatingSummary}
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
                  <p>
                    Generating a summary sends up to 30,000 characters of this
                    repository&rsquo;s source code (secrets redacted) to the configured AI provider.
                  </p>
                  {summaryError && <InlineMessage tone="error" className="mt-3">{summaryError}</InlineMessage>}
                </>
              }
              action={
                <Button
                  icon={<Sparkles size={14} aria-hidden="true" />}
                  loading={generatingSummary}
                  onClick={() => onGenerateSummary(false)}
                >
                  Generate AI summary
                </Button>
              }
            />
          )}
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
