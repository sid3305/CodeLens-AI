import { useId, useState } from 'react'
import { ChevronDown, Code2, ExternalLink, FileCode2 } from 'lucide-react'

import { api, errorMessage } from '../../services/api'
import type { Finding } from '../../types'
import CodeLines from '../code/CodeLines'
import { Badge, Button, InlineMessage, LoadingBlock, SeverityBadge, cn } from '../ui'

const CONTEXT_LINES = 12

export default function FindingCard({
  finding,
  repositoryId,
  onOpenFinding,
}: {
  finding: Finding
  repositoryId: string
  onOpenFinding: (path: string, line: number | null) => void
}) {
  const sourceId = useId()
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
      setSourceError(errorMessage(error, 'Unable to load source code.'))
    } finally {
      setSourceLoading(false)
    }
  }

  const toggleSource = () => {
    const next = !expanded
    setExpanded(next)
    if (next) void loadSource()
  }

  const targetLine = finding.line
  let excerpt: { start: number; text: string } | null = null
  if (source !== null && targetLine) {
    const lines = source.split('\n')
    const start = Math.max(0, Math.min(targetLine - 1 - 5, lines.length - CONTEXT_LINES))
    excerpt = { start: start + 1, text: lines.slice(start, start + CONTEXT_LINES).join('\n') }
  }

  const location = `${finding.file}${finding.line ? `:${finding.line}` : ''}`
  const detections = (finding.duplicate_count ?? 0) + 1

  return (
    <article className="rounded-md border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        <Badge>{finding.category}</Badge>
        {finding.detected_by.map((tool) => (
          <Badge key={tool} tone="accent">{tool}</Badge>
        ))}
        {detections > 1 && <Badge tone="neutral">{detections} detections</Badge>}
      </div>

      <h3 className="mt-2 text-md font-semibold break-words text-fg">{finding.title}</h3>
      <p className="mt-0.5 font-mono text-xs text-fg-subtle">Rule {finding.rule_id || 'not specified'}</p>

      {finding.description && (
        <p className="mt-2 text-base break-words text-fg-muted">{finding.description}</p>
      )}

      <button
        type="button"
        onClick={() => onOpenFinding(finding.file, finding.line)}
        disabled={!finding.file}
        className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-sm text-sm font-medium text-accent-text hover:underline"
      >
        <FileCode2 size={14} aria-hidden="true" className="shrink-0" />
        <span className="truncate font-mono">{location}</span>
        <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
        <span className="sr-only">(open in file preview)</span>
      </button>

      {finding.recommendation && (
        <div className="mt-3 rounded-sm border-l-4 border-l-success bg-success-soft px-3 py-2">
          <p className="text-xs font-semibold text-success">Recommended action</p>
          <p className="mt-0.5 text-sm break-words text-fg">{finding.recommendation}</p>
        </div>
      )}

      <button
        type="button"
        onClick={toggleSource}
        aria-expanded={expanded}
        aria-controls={sourceId}
        className="mt-3 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-fg-muted hover:text-fg"
      >
        <Code2 size={14} aria-hidden="true" />
        {expanded ? 'Hide source context' : 'View source context'}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn('transition-transform duration-[var(--cl-duration-fast)]', expanded && 'rotate-180')}
        />
      </button>

      <div id={sourceId} hidden={!expanded} className="mt-2">
        {expanded && (
          sourceLoading ? (
            <LoadingBlock label="Loading source code" />
          ) : sourceError ? (
            <InlineMessage tone="error">{sourceError}</InlineMessage>
          ) : !targetLine ? (
            <p className="text-sm text-fg-muted">The analyzer did not report a line for this finding.</p>
          ) : excerpt ? (
            <div className="overflow-hidden rounded-sm border border-border">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-xs text-fg-muted">
                <span>Lines {excerpt.start}–{excerpt.start + excerpt.text.split('\n').length - 1}</span>
                <Button size="sm" variant="ghost" onClick={() => onOpenFinding(finding.file, finding.line)}>
                  Open full file
                </Button>
              </div>
              <CodeLines
                content={excerpt.text}
                firstLine={excerpt.start}
                highlightLine={targetLine}
                label={`Source around ${location}`}
                className="max-h-72"
              />
            </div>
          ) : null
        )}
      </div>
    </article>
  )
}
