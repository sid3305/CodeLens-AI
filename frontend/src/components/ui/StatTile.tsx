import type { ReactNode } from 'react'

import { cn } from './cn'

/**
 * A labelled number. In the DOM the label precedes the value (read as
 * "Source files: 7"); visually the value sits on top.
 */
export function StatTile({
  label,
  value,
  icon,
  className,
}: {
  label: string
  value: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface p-4 shadow-sm',
        className,
      )}
    >
      {icon && (
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent-text"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <dl className="flex min-w-0 flex-col-reverse">
        <dt className="truncate text-sm text-fg-muted">{label}</dt>
        <dd className="truncate text-xl font-semibold text-fg tabular-nums">{value}</dd>
      </dl>
    </div>
  )
}
