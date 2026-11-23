import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '../../test/render'
import type { ComponentProps } from 'react'

import Sidebar from './Sidebar'

type Props = ComponentProps<typeof Sidebar>

function props(overrides: Partial<Props> = {}): Props {
  return {
    activeSection: 'overview',
    sectionHref: (section) => `/repo/r1/${section}`,
    repositories: [],
    selectedRepositoryId: null,
    repositoryHref: (id) => `/repo/${id}/overview`,
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
    renderWithProviders(<Sidebar {...props()} />)

    const nav = screen.getByRole('navigation', { name: /workspace/i })
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent?.trim())

    expect(labels).toEqual(['Overview', 'Architecture', 'Issues'])
  })

  it('has no controls without behaviour', () => {
    renderWithProviders(<Sidebar {...props()} />)

    expect(screen.queryByText(/workspace settings/i)).not.toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('shows the real issue count once an analysis exists', () => {
    renderWithProviders(<Sidebar {...props({ issueCount: 7 })} />)

    expect(screen.getByRole('link', { name: /issues/i })).toHaveTextContent('7')
  })

  it('links each section to its address and marks the current one (C3)', () => {
    renderWithProviders(<Sidebar {...props({ activeSection: 'issues' })} />)

    expect(screen.getByRole('link', { name: 'Architecture' })).toHaveAttribute('href', '/repo/r1/architecture')
    expect(screen.getByRole('link', { name: /issues/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
  })

  it('offers no section links while no repository is open (C3)', () => {
    renderWithProviders(<Sidebar {...props({ activeSection: null, sectionHref: () => null })} />)

    const nav = screen.getByRole('navigation', { name: /workspace/i })
    expect(within(nav).queryAllByRole('link')).toHaveLength(0)
  })
})

describe('Sidebar import (X1)', () => {
  it('imports through the panel instead of a browser prompt', async () => {
    const prompt = vi.spyOn(window, 'prompt')
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderWithProviders(<Sidebar {...props()} />)

    await user.click(screen.getByRole('button', { name: /import repository/i }))

    expect(screen.getByLabelText(/repository link/i)).toBeInTheDocument()
    expect(prompt).not.toHaveBeenCalled()
  })
})
