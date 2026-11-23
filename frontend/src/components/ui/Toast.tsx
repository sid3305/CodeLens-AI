import * as RadixToast from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react'

import { cn } from './cn'

export type ToastTone = 'success' | 'warning' | 'error'

interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

interface ToastApi {
  notify: (tone: ToastTone, message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const TONES: Record<ToastTone, { className: string; Icon: typeof CheckCircle2; label: string }> = {
  success: { className: 'border-l-success', Icon: CheckCircle2, label: 'Success' },
  warning: { className: 'border-l-warning', Icon: AlertTriangle, label: 'Warning' },
  error: { className: 'border-l-danger', Icon: XCircle, label: 'Error' },
}

/**
 * Transient notices. Errors are announced assertively (role=alert);
 * success and warnings politely (role=status). Errors stay until dismissed.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const notify = useCallback((tone: ToastTone, message: string) => {
    setItems((current) => [...current.slice(-2), { id: Date.now() + Math.random(), tone, message }])
  }, [])

  const api = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={api}>
      <RadixToast.Provider swipeDirection="right" label="Notifications">
        {children}
        {items.map((item) => {
          const { className, Icon, label } = TONES[item.tone]
          return (
            <RadixToast.Root
              key={item.id}
              type={item.tone === 'error' ? 'foreground' : 'background'}
              duration={item.tone === 'error' ? Infinity : 6000}
              onOpenChange={(open) => {
                if (!open) setItems((current) => current.filter((t) => t.id !== item.id))
              }}
              className={cn(
                'flex items-start gap-3 rounded-md border border-border border-l-4 bg-surface p-3 pr-2 text-fg shadow-lg',
                className,
              )}
            >
              <Icon size={18} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
              <RadixToast.Description className="min-w-0 flex-1 text-sm break-words">
                <span className="sr-only">{label}: </span>
                {item.message}
              </RadixToast.Description>
              <RadixToast.Close
                aria-label="Dismiss notification"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                <X size={14} aria-hidden="true" />
              </RadixToast.Close>
            </RadixToast.Root>
          )
        })}
        <RadixToast.Viewport className="fixed bottom-4 right-4 z-[var(--cl-z-toast)] flex w-[min(420px,calc(100vw-32px))] flex-col gap-2 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
