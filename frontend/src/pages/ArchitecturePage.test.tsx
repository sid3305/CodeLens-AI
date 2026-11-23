import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render'

import ArchitecturePage from './ArchitecturePage'
import { api } from '../services/api'
import type { DependenciesAnalysisResponse, Repository } from '../types'
import type { ArchitectureView } from './architectureViews'

vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/api')>()
  return { ...original, api: { getDependenciesAnalysis: vi.fn() } }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const cycle = (n: number) => ({
  cycle: [`pkg/a${n}.py`, `pkg/b${n}.py`],
  cycle_type: 'import',
  severity: 'high',
  description: `cycle ${n}`,
})

const analysis: DependenciesAnalysisResponse = {
  repository_id: 'r',
  total_internal_modules: 2,
  total_external_dependencies: 1,
  circular_dependencies: [cycle(1), cycle(2), cycle(3), cycle(4)],
  module_dependencies: [
    { source_module: 'pkg/a.py', target_module: 'pkg/b.py', import_type: 'internal', imports: ['b'], edge_count: 1 },
  ],
  external_dependencies: [
    { name: 'requests', source_files: ['pkg/a.py'], import_count: 1, language: 'python', version: null, is_dev_dependency: false },
  ],
  dependency_graph_data: {
    nodes: [], edges: [], totalNodes: 0, totalEdges: 0, showingNodes: 0, showingEdges: 0, folders: [],
  },
  language_breakdown: {},
  stats: {
    total_imports: 1, total_calls: 0, circular_import_count: 4, dead_code_count: 0, hotspot_count: 0, file_count: 2,
  },
  unresolved_imports: [
    { file: 'pkg/a.py', line: 3, specifier: '.missing', language: 'python', reason: 'No file matches this relative import' },
  ],
  skipped_files: [{ path: 'pkg/broken.py', reason: 'Syntax error on line 1' }],
  generated_at: '',
}

beforeEach(() => {
  mockedApi.getDependenciesAnalysis.mockReset()
  mockedApi.getDependenciesAnalysis.mockResolvedValue(structuredClone(analysis))
})

const repository: Repository = { id: 'r', name: 'repo', source: 'zip', file_count: 2, created_at: '' }

/** The route keeps the view in the URL; a local state stands in for it here. */
function Harness({ repo, onOpenFile }: { repo: Repository; onOpenFile: (path: string) => void }) {
  const [view, setView] = useState<ArchitectureView>('overview')
  return <ArchitecturePage repository={repo} view={view} onViewChange={setView} onOpenFile={onOpenFile} />
}

function page(repo: Repository = repository, onOpenFile = vi.fn()) {
  return <Harness key={repo.id} repo={repo} onOpenFile={onOpenFile} />
}

describe('ArchitecturePage fetching (D5 / BUG-22)', () => {
  it('does not re-run the analysis when the repository list is refreshed', async () => {
    const { rerender } = renderWithProviders(page())
    await screen.findByRole('tab', { name: /external/i })

    // A repository-list refresh produces a new object for the same repository.
    rerender(page({ ...repository }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockedApi.getDependenciesAnalysis).toHaveBeenCalledTimes(1)
  })

  it('re-runs the analysis exactly once when refresh is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(page())
    await screen.findByRole('tab', { name: /external/i })

    await user.click(screen.getByRole('button', { name: /refresh dependency analysis/i }))
    await waitFor(() => expect(mockedApi.getDependenciesAnalysis).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockedApi.getDependenciesAnalysis).toHaveBeenCalledTimes(2)
  })

  it('asks the backend to recompute on refresh, not on first load (B2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(page())
    await screen.findByRole('tab', { name: /external/i })

    const [firstId, firstOptions] = mockedApi.getDependenciesAnalysis.mock.calls[0]
    expect(firstId).toBe('r')
    expect(firstOptions.refresh).toBeUndefined()

    await user.click(screen.getByRole('button', { name: /refresh dependency analysis/i }))
    await waitFor(() =>
      expect(mockedApi.getDependenciesAnalysis).toHaveBeenLastCalledWith('r', { refresh: true }),
    )
  })

  it('never shows one repository’s analysis for another', async () => {
    const other: Repository = { ...repository, id: 'other', name: 'other' }
    mockedApi.getDependenciesAnalysis.mockImplementation((id: string) =>
      id === 'r' ? Promise.resolve(structuredClone(analysis)) : new Promise(() => {}),
    )
    const { rerender } = renderWithProviders(page())
    expect((await screen.findAllByText('a1.py')).length).toBeGreaterThan(0)

    rerender(page(other))

    expect(screen.queryAllByText('a1.py')).toHaveLength(0)
  })
})

describe('ArchitecturePage (A10)', () => {
  it('does not offer the unimplemented graph view', async () => {
    renderWithProviders(page())
    await screen.findByRole('tab', { name: /external/i })

    expect(screen.queryByRole('tab', { name: /^graph$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/will be implemented/i)).not.toBeInTheDocument()
  })

  it('"View all" opens the circular dependencies tab', async () => {
    const user = userEvent.setup()
    renderWithProviders(page())

    await user.click(await screen.findByRole('button', { name: /view all 4 circular/i }))

    expect(screen.getByText('cycle 4')).toBeInTheDocument()
  })

  it('has no per-package details button without behaviour', async () => {
    const user = userEvent.setup()
    renderWithProviders(page())

    await user.click(await screen.findByRole('tab', { name: /external/i }))

    expect(screen.queryByTitle(/view dependency details/i)).not.toBeInTheDocument()
  })
})

describe('ArchitecturePage file links (C4)', () => {
  it('opens an internal module in the file preview', async () => {
    const onOpenFile = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(page(repository, onOpenFile))

    const links = await screen.findAllByRole('button', { name: 'Open pkg/a1.py' })
    await user.click(links[0])

    expect(onOpenFile).toHaveBeenCalledWith('pkg/a1.py')
  })

  it('does not turn external packages into file links', async () => {
    const user = userEvent.setup()
    renderWithProviders(page())

    await user.click(await screen.findByRole('tab', { name: /external/i }))

    expect(screen.queryByRole('button', { name: /open requests/i })).not.toBeInTheDocument()
  })
})

describe('ArchitecturePage unresolved imports and skipped files (C4)', () => {
  it('lists each with its reason in a labelled collapsible section', async () => {
    const onOpenFile = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(page(repository, onOpenFile))

    const summary = await screen.findByText('Unresolved imports and skipped files')
    const details = summary.closest('details')!
    expect(details).toBeInTheDocument()

    expect(screen.getByText('.missing')).toBeInTheDocument()
    expect(screen.getByText('No file matches this relative import')).toBeInTheDocument()
    expect(screen.getByText('line 3')).toBeInTheDocument()
    expect(screen.getByText('Syntax error on line 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open pkg/broken.py' }))
    expect(onOpenFile).toHaveBeenCalledWith('pkg/broken.py')
  })

  it('says so when everything was resolved and parsed', async () => {
    mockedApi.getDependenciesAnalysis.mockResolvedValue({
      ...structuredClone(analysis),
      unresolved_imports: [],
      skipped_files: [],
    })
    renderWithProviders(page())

    expect(await screen.findByText('Every import was resolved.')).toBeInTheDocument()
    expect(screen.getByText('Every source file was parsed.')).toBeInTheDocument()
  })
})
