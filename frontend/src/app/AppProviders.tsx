import type { ReactNode } from 'react'

import { ThemeProvider } from '../theme/ThemeProvider'
import { ToastProvider, TooltipProvider } from '../components/ui'

/** Application-wide providers (shared by main.tsx and the tests). */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}
