import type { ReactNode } from 'react'
import { Zap } from 'lucide-react'

import { useActiveJob, useStartJob } from '../data/jobs'
import { api, errorMessage } from '../services/api'
import JobProgress from '../components/jobs/JobProgress'
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

/** Starts an analysis job, or shows the running one (also after a refresh). */
export function RunAnalysisButton({ repoId }: { repoId: string }) {
  const { notify } = useToast()
  const active = useActiveJob('analysis', repoId)
  const start = useStartJob(api.startAnalysisJob)

  if (active) return <JobProgress job={active} label="Analysis" className="w-full sm:w-80" />

  return (
    <Button
      variant="primary"
      icon={<Zap size={15} aria-hidden="true" />}
      loading={start.isPending}
      onClick={() =>
        start.mutate(repoId, {
          onError: (error) => notify('error', errorMessage(error, 'Could not start the analysis.')),
        })
      }
    >
      Run analysis
    </Button>
  )
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</div>
}
