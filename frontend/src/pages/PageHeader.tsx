import type { ReactNode } from 'react'
import { Zap } from 'lucide-react'

import { useRunAnalysis } from '../data/hooks'
import { describeAnalysis } from '../lib/analysis'
import { errorMessage } from '../services/api'
import { Button, useToast } from '../components/ui'

/** The page's single H1, its description and page actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        <p className="mt-1 text-base text-fg-muted">{description}</p>
      </div>
      {actions}
    </div>
  )
}

export function RunAnalysisButton({ repoId }: { repoId: string }) {
  const { notify } = useToast()
  const run = useRunAnalysis(repoId)

  return (
    <Button
      variant="primary"
      icon={<Zap size={15} aria-hidden="true" />}
      loading={run.isPending}
      onClick={() =>
        run.mutate(undefined, {
          onSuccess: (result) => {
            const outcome = describeAnalysis(result)
            notify(outcome.tone, outcome.message)
          },
          onError: (error) => notify('error', errorMessage(error, 'Analysis failed.')),
        })
      }
    >
      {run.isPending ? 'Analyzing…' : 'Run analysis'}
    </Button>
  )
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</div>
}
