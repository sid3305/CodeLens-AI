import { useAnalysis } from '../data/hooks'
import { describeAnalysis } from '../lib/analysis'
import type { Repository } from '../types'
import IssuesSection from '../components/workspace/IssuesSection'
import type { FindingFilters } from '../components/workspace/findingFilters'
import { LoadingBlock } from '../components/ui'
import { PageContainer, PageHeader, RunAnalysisButton } from './PageHeader'

export default function IssuesPage({
  repository,
  filters,
  onFiltersChange,
  onOpenFinding,
}: {
  repository: Repository
  filters: FindingFilters
  onFiltersChange: (filters: FindingFilters) => void
  onOpenFinding: (path: string, line: number | null) => void
}) {
  const analysis = useAnalysis(repository.id)
  const result = analysis.data ?? null

  return (
    <PageContainer>
      <PageHeader
        title="Issues"
        description="Findings from the static analyzers, merged across tools."
        actions={<RunAnalysisButton repoId={repository.id} />}
      />
      {analysis.isPending ? (
        <LoadingBlock label="Loading analysis results" lines={5} />
      ) : (
        <IssuesSection
          analysis={result}
          outcome={result ? describeAnalysis(result) : null}
          repositoryId={repository.id}
          filters={filters}
          onFiltersChange={onFiltersChange}
          onOpenFinding={onOpenFinding}
        />
      )}
    </PageContainer>
  )
}
