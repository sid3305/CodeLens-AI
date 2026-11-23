import { useAnalysis, useGenerateSummary, useRepositoryFiles, useSavedSummary } from '../data/hooks'
import { describeAnalysis } from '../lib/analysis'
import { errorMessage } from '../services/api'
import type { Repository } from '../types'
import OverviewSection from '../components/workspace/OverviewSection'
import { PageContainer, PageHeader, RunAnalysisButton } from './PageHeader'

/** Render with key={repository.id} so mutation state never crosses repositories. */
export default function OverviewPage({ repository }: { repository: Repository }) {
  const files = useRepositoryFiles(repository.id)
  const analysis = useAnalysis(repository.id)
  const saved = useSavedSummary(repository.id)
  const generate = useGenerateSummary(repository.id)

  const result = analysis.data ?? null
  const summaryError = generate.error
    ? errorMessage(generate.error, 'Failed to generate the summary.')
    : saved.error
      ? errorMessage(saved.error, 'Unable to load the saved summary.')
      : null

  return (
    <PageContainer>
      <PageHeader
        title="Overview"
        description="Repository statistics, AI summary and findings at a glance."
        actions={<RunAnalysisButton repoId={repository.id} />}
      />
      <OverviewSection
        files={files.data ?? []}
        analysis={result}
        outcome={result ? describeAnalysis(result) : null}
        summary={saved.data ?? null}
        summaryError={summaryError}
        generatingSummary={generate.isPending}
        onGenerateSummary={(force) => generate.mutate(force)}
      />
    </PageContainer>
  )
}
