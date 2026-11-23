import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Loader2 } from 'lucide-react'

import { buttonClasses } from './buttonClasses'
import type { ButtonSize, ButtonVariant } from './buttonClasses'
import { cn } from './cn'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean
  icon?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClasses(variant, size), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </button>
  )
}
