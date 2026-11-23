import { useId } from 'react'
import { CheckCircle2, ChevronDown, Search, XCircle } from 'lucide-react'

import type { AnalysisOutcome } from '../../lib/analysis'
import type { AnalysisResponse } from '../../types'
import { Badge, Card, CardBody, CardHeader, EmptyState, SeverityBadge, cn } from '../ui'
import FindingCard from './FindingCard'
import { filterFindings } from './findingFilters'
import type { FindingFilters } from './findingFilters'

const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info']

const fieldClasses =
  'h-9 rounded-sm border border-border-strong bg-surface px-2.5 text-base text-fg placeholder:text-fg-subtle'

export default function IssuesSection({
  analysis,
  outcome,
  repositoryId,
  filters,
  onFiltersChange,
  onOpenFinding,
}: {
  analysis: AnalysisResponse | null
  outcome: AnalysisOutcome | null
  repositoryId: string
  filters: FindingFilters
  onFiltersChange: (filters: FindingFilters) => void
  onOpenFinding: (path: string, line: number | null) => void
}) {
  const searchId = useId()
  const severityId = useId()
  const analyzerId = useId()

  if (!analysis) {
    return (
      <Card>
        <EmptyState
          icon={<Search size={22} />}
          title="No analysis results"
          description="Run an analysis to list the issues found in this repository."
        />
      </Card>
    )
  }

  const findings = analysis.findings
  const visible = filterFindings(findings, filters)
  const severities = SEVERITY_ORDER.filter((severity) => findings.some((f) => f.severity === severity))
  const analyzers = [...new Set(findings.flatMap((finding) => finding.detected_by))].sort()
  const counts = analysis.summary.severity_counts

  return (
    <div className="space-y-5">
      <Card aria-labelledby="results-heading">
        <CardHeader
          titleId="results-heading"
          title="Analysis results"
          description={`${findings.length} consolidated finding${findings.length === 1 ? '' : 's'} · ${new Date(analysis.analyzed_at).toLocaleString()}`}
          actions={
            outcome && (
              <Badge
                tone={outcome.tone === 'success' ? 'success' : outcome.tone === 'warning' ? 'warning' : 'danger'}
                icon={outcome.tone === 'success'
                  ? <CheckCircle2 size={12} aria-hidden="true" />
                  : <XCircle size={12} aria-hidden="true" />}
              >
                {outcome.tone === 'success'
                  ? 'All analyzers ran'
                  : outcome.tone === 'warning'
                    ? `Partial: ${outcome.failedTools.join(', ')} not run`
                    : 'Analysis failed'}
              </Badge>
            )
          }
        />
        <CardBody>
          <ul className="flex flex-wrap gap-2" aria-label="Findings by severity">
            {['Critical', 'High', 'Medium', 'Low'].map((severity) => (
              <li key={severity}>
                <SeverityBadge severity={severity} count={counts[severity] ?? 0} />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <section aria-labelledby="findings-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="findings-heading" className="text-md font-semibold">Findings</h2>
          <p className="text-sm text-fg-muted" role="status">
            Showing {visible.length} of {findings.length}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">Search findings</label>
            <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input
              id={searchId}
              type="search"
              value={filters.query}
              onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
              placeholder="Search findings, files or rules"
              className={cn(fieldClasses, 'w-full pl-8')}
            />
          </div>
          <div>
            <label htmlFor={severityId} className="sr-only">Severity</label>
            <select
              id={severityId}
              value={filters.severity}
              onChange={(event) => onFiltersChange({ ...filters, severity: event.target.value })}
              className={cn(fieldClasses, 'w-full')}
            >
              <option value="All">All severities</option>
              {severities.map((severity) => (
                <option key={severity} value={severity}>{severity}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={analyzerId} className="sr-only">Analyzer</label>
            <select
              id={analyzerId}
              value={filters.analyzer}
              onChange={(event) => onFiltersChange({ ...filters, analyzer: event.target.value })}
              className={cn(fieldClasses, 'w-full')}
            >
              <option value="All">All analyzers</option>
              {analyzers.map((analyzer) => (
                <option key={analyzer} value={analyzer}>{analyzer}</option>
              ))}
            </select>
          </div>
        </div>

        {findings.length === 0 ? (
          <Card>
            <EmptyState
              headingLevel={3}
              icon={<CheckCircle2 size={22} />}
              title="No findings"
              description="The analyzers that ran did not report anything."
            />
          </Card>
        ) : visible.length === 0 ? (
          <p className="rounded-md border border-border bg-surface px-4 py-6 text-center text-base text-fg-muted">
            No findings match your search or filters.
          </p>
        ) : (
          <ul className="space-y-3">
            {visible.map((finding) => (
              <li key={finding.id}>
                <FindingCard finding={finding} repositoryId={repositoryId} onOpenFinding={onOpenFinding} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="group rounded-md border border-border bg-surface shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <span>
            <span className="block font-semibold">Analyzer details</span>
            <span className="block text-sm text-fg-muted">Execution status and raw detection counts</span>
          </span>
          <ChevronDown size={16} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <p className="text-sm text-fg-muted">
            Counts are per tool and can overlap when several tools report the same issue.
          </p>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-fg-muted">
              <tr>
                <th scope="col" className="py-1.5 font-medium">Analyzer</th>
                <th scope="col" className="py-1.5 font-medium">Status</th>
                <th scope="col" className="py-1.5 text-right font-medium">Detections</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(analysis.tool_status).map(([tool, status]) => (
                <tr key={tool} className="border-t border-border align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {tool}
                    {status.error && <span className="mt-0.5 block font-normal break-words text-fg-muted">{status.error}</span>}
                  </th>
                  <td className="py-2 pr-3">{status.status}</td>
                  <td className="py-2 text-right tabular-nums">{status.findings}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border text-fg-muted">
              <tr>
                <td className="py-2" colSpan={2}>Raw detections · duplicates merged</td>
                <td className="py-2 text-right tabular-nums">
                  {analysis.summary.raw_total_findings} · {analysis.summary.duplicates_removed}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </div>
  )
}
