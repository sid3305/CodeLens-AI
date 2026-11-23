import * as RadixDialog from '@radix-ui/react-dialog'
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

import { cn } from './cn'

/**
 * Modal dialog: focus is trapped inside, Esc closes it, and focus returns
 * to the element that opened it (Radix behaviour).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  dismissible = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** False while an action is running: Esc and outside clicks are ignored. */
  dismissible?: boolean
}) {
  const returnFocus = useReturnFocus()

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => (dismissible || next) && onOpenChange(next)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[var(--cl-z-overlay)] bg-black/45" />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[var(--cl-z-overlay)] w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2',
            'rounded-md border border-border bg-surface p-5 shadow-lg focus-visible:outline-none',
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
          {...returnFocus}
        >
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="text-lg font-semibold text-fg">{title}</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="Close"
              className="-mr-1.5 -mt-1 inline-flex size-8 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
              disabled={!dismissible}
            >
              <X size={16} aria-hidden="true" />
            </RadixDialog.Close>
          </div>
          {description && (
            <RadixDialog.Description className="mt-2 text-base text-fg-muted">
              {description}
            </RadixDialog.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/** Off-canvas panel built on the same accessible dialog primitive. */
export function Drawer({
  open,
  onOpenChange,
  title,
  side = 'left',
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  side?: 'left' | 'right'
  children: ReactNode
}) {
  const returnFocus = useReturnFocus()

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[var(--cl-z-drawer)] bg-black/45" />
        <RadixDialog.Content
          aria-describedby={undefined}
          {...returnFocus}
          className={cn(
            'fixed inset-y-0 z-[var(--cl-z-drawer)] flex w-[min(320px,calc(100vw-48px))] flex-col bg-surface shadow-lg focus-visible:outline-none',
            side === 'left' ? 'left-0 border-r border-border' : 'right-0 border-l border-border',
          )}
        >
          <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/**
 * Radix returns focus to its own <Dialog.Trigger>. These dialogs are opened
 * by ordinary buttons elsewhere, so remember whatever had focus when the
 * dialog opened and put focus back there when it closes.
 */
function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null)

  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    },
    onCloseAutoFocus: (event: Event) => {
      if (opener.current?.isConnected) {
        event.preventDefault()
        opener.current.focus()
      }
      opener.current = null
    },
  }
}
