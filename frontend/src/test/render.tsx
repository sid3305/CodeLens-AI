import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'

import { AppProviders } from '../app/AppProviders'
import { createQueryClient } from '../data/queryClient'

/**
 * Render with the same providers the application uses, and a fresh query
 * client per test (the real retry policy, without the waiting).
 * Passed as a wrapper so `rerender` keeps the providers.
 */
export function renderWithProviders(ui: ReactElement) {
  const queryClient = createQueryClient({ retryDelay: 0 })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProviders queryClient={queryClient}>{children}</AppProviders>
  )
  return { queryClient, ...render(ui, { wrapper }) }
}
