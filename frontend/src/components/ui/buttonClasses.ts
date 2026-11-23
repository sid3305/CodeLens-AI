import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-accent border-transparent hover:bg-accent-hover',
  secondary:
    'bg-surface text-fg border-border-strong hover:bg-surface-hover',
  ghost:
    'bg-transparent text-fg-muted border-transparent hover:bg-surface-hover hover:text-fg',
  danger:
    'bg-danger text-surface border-transparent hover:opacity-90',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-9 px-4 text-base gap-2',
}

export const buttonClasses = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md') =>
  cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm border font-medium',
    'transition-colors duration-[var(--cl-duration-fast)]',
    'disabled:cursor-not-allowed disabled:opacity-55',
    VARIANTS[variant],
    SIZES[size],
  )
