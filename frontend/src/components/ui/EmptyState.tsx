import type { ReactNode } from 'react'

import { cn } from './cn'

export function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 2,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  headingLevel?: 1 | 2 | 3
  className?: string
}) {
  const Heading = (['h1', 'h2', 'h3'] as const)[headingLevel - 1]

  return (
    <div className={cn('flex flex-col items-center px-4 py-10 text-center', className)}>
      {icon && (
        <div className="mb-3 flex size-11 items-center justify-center rounded-md bg-surface-2 text-fg-muted" aria-hidden="true">
          {icon}
        </div>
      )}
      <Heading className="text-md font-semibold text-fg">{title}</Heading>
      {description && <div className="mt-1 max-w-md text-base text-fg-muted">{description}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

/** Inline message: errors are announced immediately, notices politely. */
export function InlineMessage({
  tone,
  children,
  className,
}: {
  tone: 'error' | 'info'
  children: ReactNode
  className?: string
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('text-sm', tone === 'error' ? 'text-danger' : 'text-fg-muted', className)}
    >
      {children}
    </p>
  )
}
