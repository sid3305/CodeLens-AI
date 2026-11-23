import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'

import AppRoutes from './AppRoutes'
import { api } from '../services/api'
import { renderWithProviders } from '../test/render'

vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/api')>()
  return {
    ...original,
    api: {
      health: vi.fn(),
      getRepositories: vi.fn(),
      getFiles: vi.fn(),
      getAnalysisResults: vi.fn(),
      getSummary: vi.fn(),
      getFileContent: vi.fn(),
      getDependenciesAnalysis: vi.fn(),
    },
  }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const analysis = {
  repository_id: 'r1', repository_name: 'first', status: 'completed', analyzed_at: '',
  summary: { total_findings: 1, raw_total_findings: 1, duplicates_removed: 0, severity_counts: { High: 1 }, category_counts: {}, tool_counts: {} },
  tool_status: { Ruff: { status: 'Completed', findings: 1, error: null } },
  findings: [{
    id: 'F1', title: 'A finding', description: '', severity: 'High', category: 'Security', file: 'src/a.py', line: 2,
    rule_id: 'X1', detected_by: ['Ruff'], recommendation: '', duplicate_count: 0,
  }],
}

function Address() {
  const location = useLocation()
  return <output data-testid="address">{location.pathname + location.hash}</output>
}

function renderAt(route: string) {
  return renderWithProviders(<><AppRoutes /><Address /></>, { route })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
  mockedApi.health.mockResolvedValue({ status: 'healthy' })
  mockedApi.getRepositories.mockResolvedValue([{ id: 'r1', name: 'first', source: 'zip', file_count: 2, created_at: '' }])
  mockedApi.getFiles.mockResolvedValue({
    repository_id: 'r1', total_files: 2,
    files: [{ path: 'src/a.py', name: 'a.py', extension: '.py' }, { path: 'setup.py', name: 'setup.py', extension: '.py' }],
  })
  mockedApi.getAnalysisResults.mockResolvedValue(analysis)
  mockedApi.getSummary.mockResolvedValue(null)
  mockedApi.getFileContent.mockImplementation(async (id: string, path: string) => ({ repository_id: id, path, content: 'x = 1\ny = 2\n' }))
  mockedApi.getDependenciesAnalysis.mockResolvedValue({
    repository_id: 'r1', total_internal_modules: 2, total_external_dependencies: 0, circular_dependencies: [],
    module_dependencies: [], external_dependencies: [], stdlib_imports: [], analyzed_files: ['src/a.py', 'setup.py'],
    unresolved_imports: [], skipped_files: [],
    dependency_graph_data: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0, showingNodes: 0, showingEdges: 0, folders: [] },
    language_breakdown: {},
    stats: { total_imports: 0, total_calls: 0, circular_import_count: 0, dead_code_count: 0, hotspot_count: 0, file_count: 2 },
    generated_at: '',
  })
})

describe('skip link (C9)', () => {
  it('is the first tab stop and moves focus to the main content', async () => {
    const user = userEvent.setup()
    renderAt('/repo/r1/overview')
    await screen.findByRole('heading', { level: 1, name: 'Overview' })

    await user.tab()
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('keeps the line in a file address', async () => {
    const user = userEvent.setup()
    renderAt('/repo/r1/files/src/a.py#L2')
    await screen.findByText('Line 2 highlighted')

    await user.click(screen.getByRole('link', { name: 'Skip to main content' }))

    expect(screen.getByRole('main')).toHaveFocus()
    expect(screen.getByTestId('address')).toHaveTextContent('/repo/r1/files/src/a.py#L2')
  })
})

describe('file explorer tree (C9)', () => {
  it('is a tree that opens folders and files from the keyboard', async () => {
    const user = userEvent.setup()
    renderAt('/repo/r1/overview')
    const files = await screen.findByRole('tree', { name: 'Files' })

    files.focus()
    const active = () => document.getElementById(files.getAttribute('aria-activedescendant')!)
    expect(active()).toHaveAccessibleName('src')
    expect(active()).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{ArrowRight}')
    expect(within(files).getByRole('treeitem', { name: 'src' })).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowDown}')
    expect(active()).toHaveAccessibleName('a.py')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('/repo/r1/files/src/a.py'))
    expect(within(files).getByRole('treeitem', { name: 'a.py' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('names and states (C9)', () => {
  it.each(['/repo/r1/overview', '/repo/r1/architecture', '/repo/r1/issues', '/repo/r1/files/src/a.py'])(
    'every control on %s has an accessible name',
    async (route) => {
      renderAt(route)
      await screen.findByRole('heading', { level: 1 })
      await waitFor(() => expect(screen.queryAllByLabelText(/^Loading/)).toHaveLength(0))

      for (const role of ['button', 'link', 'combobox', 'searchbox', 'textbox', 'tab', 'treeitem'] as const) {
        for (const element of screen.queryAllByRole(role)) {
          expect(element, `${role}: ${element.outerHTML.slice(0, 120)}`).toHaveAccessibleName()
        }
      }
    },
  )

  it('every disclosure says whether it is open', async () => {
    const user = userEvent.setup()
    renderAt('/repo/r1/issues')
    await screen.findByText('A finding')

    const toggles = [
      screen.getByRole('button', { name: 'Hide navigation' }),
      screen.getByRole('button', { name: /import repository/i }),
      screen.getByRole('button', { name: /view source context/i }),
      ...screen.getAllByRole('button').filter((button) => /^(workspace|repositories|files)$/i.test(button.textContent ?? '')),
    ]
    expect(toggles.length).toBeGreaterThanOrEqual(6)
    for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-expanded')

    const source = screen.getByRole('button', { name: /view source context/i })
    await user.click(source)
    expect(source).toHaveAttribute('aria-expanded', 'true')
  })

  it('reports API status politely and errors as alerts', async () => {
    renderAt('/repo/r1/overview')
    expect(await screen.findByText('API connected')).toBeInTheDocument()
    expect(screen.getByText('API connected').closest('[role="status"]')).not.toBeNull()
  })
})
