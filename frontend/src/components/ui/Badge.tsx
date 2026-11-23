import type { ReactNode } from 'react'
import { AlertOctagon, AlertTriangle, Info, ShieldAlert, CircleDot } from 'lucide-react'

import { cn } from './cn'
import { normaliseSeverity, type Severity } from './severity'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  accent: 'bg-accent-soft text-accent-text',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
}

export function Badge({
  tone = 'neutral',
  icon,
  className,
  children,
}: {
  tone?: BadgeTone
  icon?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}


const SEVERITY: Record<Severity, { className: string; Icon: typeof Info }> = {
  // Distinct icon shapes so severity never relies on colour alone.
  Critical: { className: 'bg-sev-critical-soft text-sev-critical', Icon: AlertOctagon },
  High: { className: 'bg-sev-high-soft text-sev-high', Icon: ShieldAlert },
  Medium: { className: 'bg-sev-medium-soft text-sev-medium', Icon: AlertTriangle },
  Low: { className: 'bg-sev-low-soft text-sev-low', Icon: CircleDot },
  Info: { className: 'bg-sev-info-soft text-sev-info', Icon: Info },
}


/** Severity label with a distinct icon per level; the text is always shown. */
export function SeverityBadge({ severity, count }: { severity: string; count?: number }) {
  const level = normaliseSeverity(severity)
  const { className, Icon } = SEVERITY[level]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        className,
      )}
    >
      <Icon size={12} aria-hidden="true" />
      {count !== undefined ? `${count} ${level}` : level}
    </span>
  )
}
