import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { useAiAllowed, useAnalysis, useExplainFile, useFileContent, useStoredExplanation } from '../data/hooks'
import AiConsentNotice from '../components/ai/AiConsent'
import { api, errorMessage } from '../services/api'
import type { Repository } from '../types'
import FilePreviewSection from '../components/workspace/FilePreviewSection'
import { InlineMessage, normaliseSeverity } from '../components/ui'
import type { LineMarker, LineSelection } from '../components/code/CodeViewer'
import { PageContainer, PageHeader } from './PageHeader'

/**
 * Render with key={`${repository.id}:${path}`}: content, explanation and the
 * explain request all belong to this one file, so nothing can leak across.
 */
export default function FilePreviewPage({
  repository,
  path,
  line,
  onSelectLine,
}: {
  repository: Repository
  path: string | null
  line: number | null
  /** Sets #L<line> in the address. */
  onSelectLine: (line: number) => void
}) {
  const content = useFileContent(repository.id, path)
  const stored = useStoredExplanation(repository.id, path ?? '')
  const explain = useExplainFile(repository.id)
  const aiAllowed = useAiAllowed(repository.id)
  const findings = useAnalysis(repository.id).data?.findings
  const [selection, setSelection] = useState<LineSelection | null>(null)

  const markers = useMemo<LineMarker[]>(
    () =>
      (findings ?? [])
        .filter((finding) => finding.file === path && finding.line)
        .map((finding) => ({ line: finding.line!, severity: normaliseSeverity(finding.severity), title: finding.title }))
        .sort((a, b) => a.line - b.line),
    [findings, path],
  )

  // C5: only the selected lines are sent. Never retried. The page is keyed by
  // file, so an answer can only ever show for the file it was asked about.
  const explainSelection = useMutation({
    mutationFn: (range: LineSelection) => api.explainSelection(repository.id, path!, range.start, range.end),
    retry: false,
  })
  const answer = explainSelection.data

  return (
    <PageContainer>
      <PageHeader title="File preview" description="Read a file and ask the AI to explain it." />
      {content.error ? (
        <InlineMessage tone="error">{errorMessage(content.error, 'Unable to read this file.')}</InlineMessage>
      ) : (
        <FilePreviewSection
          path={path}
          content={content.data ?? null}
          line={line}
          explanation={stored.data?.explanation ?? null}
          explanationError={explain.error ? errorMessage(explain.error, 'Failed to explain this file.') : null}
          explaining={explain.isPending}
          onExplain={() => path && explain.mutate(path)}
          aiAllowed={aiAllowed}
          aiNotice={
            <AiConsentNotice
              repoId={repository.id}
              sends={selection ? `lines ${selection.start}–${selection.end} of this file` : 'this file, trimmed to the token limit,'}
              estimate={
                path
                  ? selection
                    ? { task: 'explain', file_path: path, start_line: selection.start, end_line: selection.end }
                    : { task: 'explain', file_path: path }
                  : null
              }
            />
          }
          markers={markers}
          onLineClick={onSelectLine}
          selection={selection}
          onSelectionChange={setSelection}
          onExplainSelection={(range) => explainSelection.mutate(range)}
          explainingSelection={explainSelection.isPending}
          selectionAnswer={
            answer && answer.start_line && answer.end_line
              ? { start: answer.start_line, end: answer.end_line, text: answer.explanation }
              : null
          }
          selectionError={explainSelection.error ? errorMessage(explainSelection.error, 'Failed to explain the selection.') : null}
        />
      )}
    </PageContainer>
  )
}
