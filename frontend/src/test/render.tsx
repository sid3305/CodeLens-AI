import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactElement, ReactNode } from 'react'

import { AppProviders } from '../app/AppProviders'
import { createQueryClient } from '../data/queryClient'

/**
 * Render with the same providers the application uses, and a fresh query
 * client per test (the real retry policy, without the waiting).
 * Passed as a wrapper so `rerender` keeps the providers. `route` is the
 * initial address of the in-memory router.
 */
export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const queryClient = createQueryClient({ retryDelay: 0 })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      <AppProviders queryClient={queryClient}>{children}</AppProviders>
    </MemoryRouter>
  )
  return { queryClient, ...render(ui, { wrapper }) }
}
