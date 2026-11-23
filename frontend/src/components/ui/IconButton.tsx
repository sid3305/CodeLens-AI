import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

import { cn } from './cn'
import { Tooltip } from './Tooltip'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Required: icon-only buttons have no visible text. */
  'aria-label': string
  icon: ReactNode
  size?: 'sm' | 'md'
  /** Show the label in a tooltip on hover/focus (default true). */
  tooltip?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({
  icon,
  size = 'md',
  tooltip = true,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm text-fg-muted',
        'transition-colors duration-[var(--cl-duration-fast)] hover:bg-surface-hover hover:text-fg',
        'disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'size-8' : 'size-9',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  )

  return tooltip ? <Tooltip content={rest['aria-label']}>{button}</Tooltip> : button
}
