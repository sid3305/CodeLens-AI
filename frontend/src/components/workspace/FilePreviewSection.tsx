import type { ReactNode } from 'react'
import { FileCode2, RefreshCw, Sparkles } from 'lucide-react'

import CodeLines from '../code/CodeLines'
import MarkdownContent from '../layout/MarkdownContent'
import { Button, Card, CardBody, CardHeader, EmptyState, InlineMessage, LoadingBlock } from '../ui'

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
}) {
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
        {content === null ? (
          <CardBody><LoadingBlock label="Loading file content" lines={6} /></CardBody>
        ) : (
          <CodeLines
            content={content}
            highlightLine={line}
            label={`Contents of ${path}`}
            className="max-h-[70vh] rounded-b-md"
          />
        )}
      </Card>

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
