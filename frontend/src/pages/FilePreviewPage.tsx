import { useExplainFile, useFileContent, useStoredExplanation } from '../data/hooks'
import { errorMessage } from '../services/api'
import type { Repository } from '../types'
import FilePreviewSection from '../components/workspace/FilePreviewSection'
import { InlineMessage } from '../components/ui'
import { PageContainer, PageHeader } from './PageHeader'

/**
 * Render with key={`${repository.id}:${path}`}: content, explanation and the
 * explain request all belong to this one file, so nothing can leak across.
 */
export default function FilePreviewPage({
  repository,
  path,
  line,
}: {
  repository: Repository
  path: string | null
  line: number | null
}) {
  const content = useFileContent(repository.id, path)
  const stored = useStoredExplanation(repository.id, path ?? '')
  const explain = useExplainFile(repository.id)

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
        />
      )}
    </PageContainer>
  )
}
