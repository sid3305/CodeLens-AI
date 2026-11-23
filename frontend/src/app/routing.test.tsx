import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation, useNavigate } from 'react-router'

import AppRoutes from './AppRoutes'
import { filtersFromSearch, filtersToSearch, lineFromHash, paths, sectionFromPath } from './paths'
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
      getAiConsent: vi.fn(async (id: string) => ({ repository_id: id, enabled: true, provider: 'Groq', model: 'test-model', configured: true, problem: null })),
      setAiConsent: vi.fn(),
      getFileContent: vi.fn(),
      getDependenciesAnalysis: vi.fn(),
    },
  }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const repos = [
  { id: 'r1', name: 'first', source: 'zip', file_count: 2, created_at: '' },
  { id: 'r2', name: 'second', source: 'zip', file_count: 1, created_at: '' },
]

const finding = (id: string, severity: string, tool: string, title: string) => ({
  id, title, description: '', severity, category: 'Security', file: 'src/a.py', line: 2,
  rule_id: id, detected_by: [tool], recommendation: '', duplicate_count: 0,
})

const analysis = {
  repository_id: 'r1', repository_name: 'first', status: 'completed', analyzed_at: '',
  summary: {
    total_findings: 2, raw_total_findings: 2, duplicates_removed: 0,
    severity_counts: { High: 1, Low: 1 }, category_counts: {}, tool_counts: {},
  },
  tool_status: { Ruff: { status: 'Completed', findings: 1, error: null }, Bandit: { status: 'Completed', findings: 1, error: null } },
  findings: [finding('F1', 'High', 'Bandit', 'High finding'), finding('F2', 'Low', 'Ruff', 'Low finding')],
}

const dependencies = {
  repository_id: 'r1', total_internal_modules: 1, total_external_dependencies: 1,
  circular_dependencies: [], module_dependencies: [],
  external_dependencies: [
    { name: 'requests', source_files: ['src/a.py'], import_count: 1, language: 'python', version: null, is_dev_dependency: false },
  ],
  dependency_graph_data: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0, showingNodes: 0, showingEdges: 0, folders: [] },
  language_breakdown: {},
  stats: { total_imports: 1, total_calls: 0, circular_import_count: 0, dead_code_count: 0, hotspot_count: 0, file_count: 1 },
  unresolved_imports: [], skipped_files: [], generated_at: '',
}

/** Back/forward buttons and the current address, as a browser would offer. */
function BrowserChrome() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <div>
      <button type="button" onClick={() => navigate(-1)}>Browser back</button>
      <button type="button" onClick={() => navigate(1)}>Browser forward</button>
      <output data-testid="address">{location.pathname + location.search + location.hash}</output>
    </div>
  )
}

function renderAt(route: string) {
  return renderWithProviders(
    <>
      <AppRoutes />
      <BrowserChrome />
    </>,
    { route },
  )
}

const address = () => screen.getByTestId('address').textContent

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.health.mockResolvedValue({ status: 'healthy' })
  mockedApi.getRepositories.mockResolvedValue(repos)
  mockedApi.getFiles.mockImplementation(async (id: string) => ({
    repository_id: id, total_files: 2,
    files: [
      { path: 'src/a.py', name: 'a.py', extension: '.py' },
      { path: 'src/b c.py', name: 'b c.py', extension: '.py' },
    ],
  }))
  mockedApi.getAnalysisResults.mockImplementation(async (id: string) => (id === 'r1' ? analysis : null))
  mockedApi.getSummary.mockResolvedValue(null)
  mockedApi.getFileContent.mockImplementation(async (id: string, path: string) => ({
    repository_id: id, path, content: `first line of ${path}\nsecond line\nthird line`,
  }))
  mockedApi.getDependenciesAnalysis.mockResolvedValue(dependencies)
})

describe('path helpers (C3)', () => {
  it('builds addresses with encoded segments and an optional line', () => {
    expect(paths.section('r1', 'issues')).toBe('/repo/r1/issues')
    expect(paths.file('r1', 'src/b c.py', 12)).toBe('/repo/r1/files/src/b%20c.py#L12')
    expect(paths.file('r1')).toBe('/repo/r1/files')
  })

  it('reads the section from a pathname', () => {
    expect(sectionFromPath('/repo/r1/architecture')).toBe('architecture')
    expect(sectionFromPath('/repo/r1/files/a.py')).toBe('file-preview')
    expect(sectionFromPath('/')).toBeNull()
    expect(sectionFromPath('/repo/r1/unknown')).toBeNull()
  })

  it('accepts only #L<positive number> as a line', () => {
    expect(lineFromHash('#L42')).toBe(42)
    expect(lineFromHash('#L0')).toBeNull()
    expect(lineFromHash('#42')).toBeNull()
    expect(lineFromHash('#Lfoo')).toBeNull()
    expect(lineFromHash('')).toBeNull()
  })

  it('round-trips issue filters and keeps defaults out of the URL', () => {
    const filters = { query: 'sql', severity: 'High', analyzer: 'Bandit' }
    expect(filtersFromSearch(filtersToSearch(filters))).toEqual(filters)
    expect(filtersToSearch({ query: '', severity: 'All', analyzer: 'All' }).toString()).toBe('')
  })
})

describe('deep links restore state (C3)', () => {
  it('/ opens the first repository', async () => {
    renderAt('/')

    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(address()).toBe('/repo/r1/overview')
  })

  it('issue filters come from the address', async () => {
    renderAt('/repo/r1/issues?severity=High&q=finding&analyzer=Bandit')

    expect(await screen.findByText('High finding')).toBeInTheDocument()
    expect(screen.queryByText('Low finding')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Severity')).toHaveValue('High')
    expect(screen.getByLabelText('Analyzer')).toHaveValue('Bandit')
    expect(screen.getByRole('searchbox', { name: 'Search findings' })).toHaveValue('finding')
  })

  it('a file address opens the file with the line highlighted', async () => {
    renderAt('/repo/r1/files/src/b%20c.py#L2')

    expect(await screen.findByText(/first line of src\/b c\.py/)).toBeInTheDocument()
    expect(mockedApi.getFileContent.mock.calls[0].slice(0, 2)).toEqual(['r1', 'src/b c.py'])
    expect(screen.getByText('Line 2 highlighted')).toBeInTheDocument()
    expect(document.title).toBe('b c.py · first · CodeLens AI')
  })

  it('the architecture view comes from the address', async () => {
    renderAt('/repo/r1/architecture?view=external')

    const tab = await screen.findByRole('tab', { name: /external/i })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('requests')).toBeInTheDocument()
  })

  it('an unknown architecture view falls back to the tree (the default)', async () => {
    renderAt('/repo/r1/architecture?view=bogus')

    expect(await screen.findByRole('tab', { name: 'Tree' })).toHaveAttribute('aria-selected', 'true')
  })

  it('the file selected in the tree comes from the address (X2)', async () => {
    renderAt('/repo/r1/architecture?file=src%2Fa.py')

    const panel = await screen.findByRole('region', { name: 'a.py' })
    expect(panel).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /^a\.py/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('selecting a file in the tree updates the address without a new history entry (X2)', async () => {
    const user = userEvent.setup()
    renderAt('/repo/r1/overview')
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    await user.click(screen.getByRole('link', { name: 'Architecture' }))

    await user.click(await screen.findByRole('treeitem', { name: /^a\.py/ }))
    await waitFor(() => expect(address()).toBe('/repo/r1/architecture?file=src%2Fa.py'))

    await user.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })
})

describe('back and forward (C3)', () => {
  it('restore the section and the filters', async () => {
    const user = userEvent.setup()
    renderAt('/repo/r1/overview')
    await screen.findByRole('heading', { level: 1, name: 'Overview' })

    await user.click(screen.getByRole('link', { name: /issues/i }))
    await screen.findByText('Low finding')
    await user.selectOptions(screen.getByLabelText('Severity'), 'High')
    await waitFor(() => expect(address()).toBe('/repo/r1/issues?severity=High'))
    expect(screen.queryByText('Low finding')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(await screen.findByText('Low finding')).toBeInTheDocument()
    expect(screen.getByLabelText('Severity')).toHaveValue('All')

    await user.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Browser forward' }))
    await user.click(screen.getByRole('button', { name: 'Browser forward' }))
    await waitFor(() => expect(screen.getByLabelText('Severity')).toHaveValue('High'))
    expect(screen.queryByText('Low finding')).not.toBeInTheDocument()
  })

  it('typing a search replaces the history entry instead of adding one per key', async () => {
    const user = userEvent.setup()
    renderAt('/repo/r1/overview')
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    await user.click(screen.getByRole('link', { name: /issues/i }))

    await user.type(await screen.findByRole('searchbox', { name: 'Search findings' }), 'high')
    await waitFor(() => expect(address()).toBe('/repo/r1/issues?q=high'))

    await user.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  it('opening a file from the explorer is a history entry', async () => {
    const user = userEvent.setup()
    renderAt('/repo/r1/issues')
    await screen.findByText('Low finding')

    await user.click(screen.getByRole('treeitem', { name: 'src' }))
    await user.click(screen.getByRole('treeitem', { name: 'a.py' }))
    await screen.findByText(/first line of src\/a\.py/)
    expect(address()).toBe('/repo/r1/files/src/a.py')

    await user.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(await screen.findByText('Low finding')).toBeInTheDocument()
  })
})

describe('switching repositories (C3)', () => {
  it('keeps the section and changes the address', async () => {
    const user = userEvent.setup()
    renderAt('/repo/r1/architecture')
    await screen.findByRole('heading', { level: 1, name: 'Architecture' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Repository' }), 'r2')

    await waitFor(() => expect(address()).toBe('/repo/r2/architecture'))
  })
})

describe('not found states (C3)', () => {
  it('an unknown address shows a 404 with a way back', async () => {
    const user = userEvent.setup()
    renderAt('/settings/nothing')

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /go to your repositories/i }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  it('an unknown section of a repository is a 404', async () => {
    renderAt('/repo/r1/settings')

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
  })

  it('a missing repository says so and offers a way back', async () => {
    const user = userEvent.setup()
    renderAt('/repo/deleted-id/issues')

    const heading = await screen.findByRole('heading', { level: 1, name: 'Repository not found' })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText('deleted-id')).toBeInTheDocument()
    expect(document.title).toBe('Repository not found · CodeLens AI')
    // The header does not claim a repository is selected.
    expect(within(screen.getByRole('banner')).getByRole('combobox', { name: 'Repository' })).toHaveValue('')

    await user.click(screen.getByRole('link', { name: /back to your repositories/i }))
    await waitFor(() => expect(address()).toBe('/repo/r1/overview'))
  })

  it('/ with no repositories shows the welcome page', async () => {
    mockedApi.getRepositories.mockResolvedValue([])
    renderAt('/')

    expect(await screen.findByRole('heading', { level: 1, name: /welcome to codelens ai/i })).toBeInTheDocument()
  })
})
