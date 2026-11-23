import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'

import Sidebar from './Sidebar'

type Props = ComponentProps<typeof Sidebar>

function props(overrides: Partial<Props> = {}): Props {
  return {
    activeSection: 'overview',
    onNavigate: vi.fn(),
    repositories: [],
    selectedRepositoryId: null,
    onSelectRepository: vi.fn(),
    files: [],
    selectedFilePath: null,
    onSelectFile: vi.fn(),
    onImportZip: vi.fn(async () => {}),
    onImportGitHub: vi.fn(async () => {}),
    onDeleteRepository: vi.fn(),
    importing: false,
    loading: false,
    issueCount: null,
    ...overrides,
  }
}

describe('Sidebar navigation (A10)', () => {
  it('only offers sections that are implemented', () => {
    render(<Sidebar {...props()} />)

    const nav = screen.getByRole('navigation', { name: /workspace/i })
    const labels = within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())

    expect(labels).toEqual(['Overview', 'Architecture', 'Issues'])
  })

  it('has no controls without behaviour', () => {
    render(<Sidebar {...props()} />)

    expect(screen.queryByText(/workspace settings/i)).not.toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('shows the real issue count once an analysis exists', () => {
    render(<Sidebar {...props({ issueCount: 7 })} />)

    expect(screen.getByRole('button', { name: /issues/i })).toHaveTextContent('7')
  })
})
