import { X } from 'lucide-react'

import { useCancelJob } from '../../data/jobs'
import type { Job } from '../../types'
import { IconButton, cn } from '../ui'

/** A running job: what it is doing, how far it got, and Cancel. */
export default function JobProgress({ job, label, className }: { job: Job; label: string; className?: string }) {
  const cancel = useCancelJob()
  const percent = job.progress === null ? null : Math.round(job.progress * 100)
  const cancelling = cancel.isPending || job.message === 'Cancelling…'

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg" aria-live="polite">
          <span className="font-medium">{label}:</span> {job.message}
          {percent !== null && <span className="text-fg-muted"> · {percent}%</span>}
        </p>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          aria-valuetext={percent === null ? job.message : `${percent}%, ${job.message}`}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className={cn(
              'h-full rounded-full bg-accent transition-[width] duration-[var(--cl-duration-base)]',
              percent === null && 'w-1/3 animate-pulse',
            )}
            style={percent === null ? undefined : { width: `${Math.max(percent, 3)}%` }}
          />
        </div>
      </div>
      <IconButton
        size="sm"
        aria-label={`Cancel ${label.toLowerCase()}`}
        icon={<X size={14} />}
        disabled={cancelling}
        onClick={() => cancel.mutate(job.id)}
      />
    </div>
  )
}
