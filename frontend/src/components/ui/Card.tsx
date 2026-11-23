import type { ElementType, ReactNode } from 'react'

import { cn } from './cn'

export function Card({
  as: Component = 'section',
  className,
  children,
  ...rest
}: {
  as?: ElementType
  className?: string
  children: ReactNode
  'aria-labelledby'?: string
}) {
  return (
    <Component
      className={cn('rounded-md border border-border bg-surface shadow-sm', className)}
      {...rest}
    >
      {children}
    </Component>
  )
}

export function CardHeader({
  title,
  titleId,
  description,
  actions,
  level = 2,
}: {
  title: ReactNode
  titleId?: string
  description?: ReactNode
  actions?: ReactNode
  level?: 2 | 3
}) {
  const Heading = level === 2 ? 'h2' : 'h3'

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <Heading id={titleId} className="text-md font-semibold text-fg">
          {title}
        </Heading>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-4 py-4 sm:px-5', className)}>{children}</div>
}
