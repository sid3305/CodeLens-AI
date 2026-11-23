import { lazy, Suspense, useState } from 'react'
import { FileDown } from 'lucide-react'

import { Button } from '../components/ui'
import { useStaticSummary, useAiAllowed, useAnalysis, useGenerateSummary, useRepositoryFiles, useSavedSummary } from '../data/hooks'
import AiConsentNotice from '../components/ai/AiConsent'
import { describeAnalysis } from '../lib/analysis'
import { errorMessage } from '../services/api'
import type { Repository } from '../types'
import OverviewSection from '../components/workspace/OverviewSection'
import { PageContainer, PageHeader, RunAnalysisButton } from './PageHeader'

const SUMMARY_ESTIMATE = { task: 'summary' } as const

// The export code is only loaded when the panel is opened (X3).
const ExportPanel = lazy(() => import('../components/export/ExportPanel'))

/** Render with key={repository.id} so mutation state never crosses repositories. */
export default function OverviewPage({ repository }: { repository: Repository }) {
  const files = useRepositoryFiles(repository.id)
  const analysis = useAnalysis(repository.id)
  const saved = useSavedSummary(repository.id)
  const generate = useGenerateSummary(repository.id)
  const aiAllowed = useAiAllowed(repository.id)
  const staticSummary = useStaticSummary(repository.id).data ?? null
  const [exportOpen, setExportOpen] = useState(false)

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
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={<FileDown size={15} aria-hidden="true" />}
              aria-expanded={exportOpen}
              onClick={() => setExportOpen(!exportOpen)}
            >
              Export report
            </Button>
            <RunAnalysisButton repoId={repository.id} />
          </div>
        }
      />
      {exportOpen && (
        <Suspense fallback={null}>
          <ExportPanel repoId={repository.id} hasSummary={Boolean(saved.data)} />
        </Suspense>
      )}
      <OverviewSection
        files={files.data ?? []}
        analysis={result}
        outcome={result ? describeAnalysis(result) : null}
        summary={saved.data ?? null}
        summaryError={summaryError}
        generatingSummary={generate.isPending}
        onGenerateSummary={(force) => generate.mutate(force)}
        aiAllowed={aiAllowed}
        staticSummary={staticSummary}
        aiNotice={
          <AiConsentNotice
            repoId={repository.id}
            sends="a fact sheet about this repository (languages, dependencies, structure, top findings, the start of the README and function signatures; no full source)"
            estimate={SUMMARY_ESTIMATE}
          />
        }
      />
    </PageContainer>
  )
}
