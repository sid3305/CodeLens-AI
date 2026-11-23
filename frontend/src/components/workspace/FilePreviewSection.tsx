import type { ReactNode } from 'react'
import { FileCode2, RefreshCw, Sparkles } from 'lucide-react'

import CodeViewer, { type LineMarker, type LineSelection } from '../code/CodeViewer'
import MarkdownContent from '../layout/MarkdownContent'
import { Button, Card, CardBody, CardHeader, EmptyState, InlineMessage, LoadingBlock, SeverityBadge } from '../ui'

/** The backend explains at most this many selected lines. */
export const MAX_SELECTION_LINES = 400

export default function FilePreviewSection({
  path,
  content,
  line,
  explanation,
  explanationError,
  explaining,
  onExplain,
  aiAllowed,
  aiNotice,
  markers,
  onLineClick,
  selection,
  onSelectionChange,
  onExplainSelection,
  explainingSelection,
  selectionAnswer,
  selectionError,
}: {
  path: string | null
  content: string | null
  line: number | null
  explanation: string | null
  explanationError: string | null
  explaining: boolean
  onExplain: () => void
  /** B6: AI may only run after the user allowed it for this repository. */
  aiAllowed: boolean
  aiNotice: ReactNode
  /** Findings in this file, shown in the gutter and listed below the code. */
  markers: LineMarker[]
  onLineClick: (line: number) => void
  selection: LineSelection | null
  onSelectionChange: (selection: LineSelection | null) => void
  onExplainSelection: (selection: LineSelection) => void
  explainingSelection: boolean
  selectionAnswer: { start: number; end: number; text: string } | null
  selectionError: string | null
}) {
  const selectedLines = selection ? selection.end - selection.start + 1 : 0
  const tooLong = selectedLines > MAX_SELECTION_LINES
  if (!path) {
    return (
      <Card>
        <EmptyState
          icon={<FileCode2 size={22} />}
          title="No file selected"
          description="Select a file in the explorer to preview it here."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <Card aria-labelledby="file-heading">
        <CardHeader
          titleId="file-heading"
          title={<span className="font-mono text-base break-all">{path}</span>}
          description={line !== null ? `Line ${line} highlighted` : undefined}
          actions={
            content !== null && (
              <Button
                variant={explanation ? 'secondary' : 'primary'}
                icon={explanation ? <RefreshCw size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                loading={explaining}
                disabled={!aiAllowed}
                onClick={onExplain}
              >
                {explaining ? 'Explaining…' : explanation ? 'Regenerate explanation' : 'Explain this file'}
              </Button>
            )
          }
        />
        {content !== null && <div className="px-4 pt-3 sm:px-5">{aiNotice}</div>}
        {explanationError && (
          <InlineMessage tone="error" className="px-4 pt-3 sm:px-5">{explanationError}</InlineMessage>
        )}
        {selection && content !== null && (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3 sm:px-5" role="status">
            <span className="text-sm text-fg-muted">
              Selected {selection.start === selection.end ? `line ${selection.start}` : `lines ${selection.start}–${selection.end}`}
              {tooLong && ` · select at most ${MAX_SELECTION_LINES} lines to explain`}
            </span>
            <Button
              size="sm"
              icon={<Sparkles size={14} aria-hidden="true" />}
              disabled={!aiAllowed || tooLong}
              loading={explainingSelection}
              onClick={() => onExplainSelection(selection)}
            >
              Explain selection
            </Button>
            {aiAllowed && !tooLong && <span className="text-xs text-fg-subtle">Sends only these lines.</span>}
          </div>
        )}
        {selectionError && <InlineMessage tone="error" className="px-4 pt-3 sm:px-5">{selectionError}</InlineMessage>}
        {content === null ? (
          <CardBody><LoadingBlock label="Loading file content" lines={6} /></CardBody>
        ) : (
          <div className="mt-3 overflow-hidden rounded-b-md border-t border-border">
            <CodeViewer
              path={path}
              content={content}
              line={line}
              markers={markers}
              onLineClick={onLineClick}
              onSelectionChange={onSelectionChange}
            />
          </div>
        )}
      </Card>

      {markers.length > 0 && (
        <Card aria-labelledby="file-findings-heading">
          <CardHeader titleId="file-findings-heading" title={`Findings in this file (${markers.length})`} />
          <CardBody>
            <ul className="space-y-1.5">
              {markers.map((marker, index) => (
                <li key={`${marker.line}:${index}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <SeverityBadge severity={marker.severity} />
                  <button
                    type="button"
                    onClick={() => onLineClick(marker.line)}
                    className="rounded-sm text-left text-accent-text underline-offset-2 hover:underline"
                  >
                    Line {marker.line}: {marker.title}
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {selectionAnswer && (
        <Card aria-labelledby="selection-explanation-heading">
          <CardHeader
            titleId="selection-explanation-heading"
            title={`AI explanation of lines ${selectionAnswer.start}–${selectionAnswer.end}`}
            description={path}
          />
          <CardBody>
            <div className="prose-content">
              <MarkdownContent content={selectionAnswer.text} />
            </div>
          </CardBody>
        </Card>
      )}

      {explanation && (
        <Card aria-labelledby="explanation-heading">
          <CardHeader titleId="explanation-heading" title="AI explanation" description={path} />
          <CardBody>
            <div className="prose-content">
              <MarkdownContent content={explanation} />
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
