import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

import { AppProviders } from '../app/AppProviders'

/**
 * Render with the same providers the application uses. Passed as a wrapper
 * so `rerender` keeps them.
 */
export function renderWithProviders(ui: ReactElement) {
  return render(ui, { wrapper: AppProviders })
}
