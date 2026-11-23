import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AppRoutes from '../../app/AppRoutes'
import { api } from '../../services/api'
import { renderWithProviders } from '../../test/render'

vi.mock('../../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/api')>()
  return {
    ...original,
    api: {
      health: vi.fn(),
      getRepositories: vi.fn(),
      getFiles: vi.fn(),
      getAnalysisResults: vi.fn(),
      getSummary: vi.fn(),
      getDependenciesAnalysis: vi.fn(),
    },
  }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const repos = [
  { id: 'r1', name: 'first', source: 'zip', file_count: 1, created_at: '' },
  { id: 'r2', name: 'second', source: 'github', file_count: 1, created_at: '', ref: 'main' },
]

function viewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
    return {
      matches: query.includes('min-width') ? width >= min : false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
  })
}

beforeEach(() => {
  mockedApi.health.mockResolvedValue({ status: 'healthy' })
  mockedApi.getRepositories.mockResolvedValue(repos)
  mockedApi.getFiles.mockImplementation(async (id: string) => ({
    repository_id: id, total_files: 1, files: [{ path: `${id}.py`, name: `${id}.py`, extension: '.py' }],
  }))
  mockedApi.getAnalysisResults.mockRejectedValue(new Error('none'))
  mockedApi.getSummary.mockResolvedValue(null)
  mockedApi.getDependenciesAnalysis.mockReturnValue(new Promise(() => {}))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('layout landmarks (C2)', () => {
  it('has one header, one main and one h1', async () => {
    viewport(1280)
    renderWithProviders(<AppRoutes />)
    await screen.findByRole('heading', { level: 1, name: 'Overview' })

    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('navigation', { name: 'Breadcrumb' })).toHaveLength(1)
  })

  it('shows health and theme controls in the header', async () => {
    viewport(1280)
    renderWithProviders(<AppRoutes />)
    const header = screen.getByRole('banner')

    expect(await within(header).findByText(/api connected/i)).toBeInTheDocument()
    expect(within(header).getByRole('group', { name: 'Theme' })).toBeInTheDocument()
  })

  it('switches repository from the header', async () => {
    viewport(1280)
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)
    const switcher = await within(screen.getByRole('banner')).findByRole('combobox', { name: 'Repository' })

    await user.selectOptions(switcher, 'r2')

    expect(await screen.findByRole('button', { name: 'r2.py' })).toBeInTheDocument()
  })
})

describe('navigation at desktop width (C2)', () => {
  it('shows the sidebar inline and lets it collapse', async () => {
    viewport(1280)
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)
    await screen.findByRole('navigation', { name: 'Workspace sections' })

    const toggle = screen.getByRole('button', { name: 'Hide navigation' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)

    expect(screen.queryByRole('navigation', { name: 'Workspace sections' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show navigation' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe.each([375, 768])('navigation at %ipx (C2)', (width) => {
  it('lives in a drawer that closes after navigating', async () => {
    viewport(width)
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)
    await screen.findByRole('heading', { level: 1, name: 'Overview' })

    expect(screen.queryByRole('navigation', { name: 'Workspace sections' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })
    await user.click(within(drawer).getByRole('link', { name: 'Issues' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('heading', { level: 1, name: 'Issues' })).toBeInTheDocument()
  })

  it('closes with Escape and returns focus to the menu button', async () => {
    viewport(width)
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)
    const open = await screen.findByRole('button', { name: 'Open navigation' })

    await user.click(open)
    await screen.findByRole('dialog', { name: 'Navigation' })
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(open).toHaveFocus())
  })
})
