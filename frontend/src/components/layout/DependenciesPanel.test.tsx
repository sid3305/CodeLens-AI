import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import DependenciesPanel from './DependenciesPanel'
import { api } from '../../services/api'
import type { DependenciesAnalysisResponse, Repository } from '../../types'

vi.mock('../../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/api')>()
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
  generated_at: '',
}

beforeEach(() => {
  mockedApi.getDependenciesAnalysis.mockResolvedValue(structuredClone(analysis))
})

const repository: Repository = { id: 'r', name: 'repo', source: 'zip', file_count: 2, created_at: '' }

describe('DependenciesPanel fetching (D5 / BUG-22)', () => {
  it('does not re-run the analysis when the repository list is refreshed', async () => {
    const { rerender } = render(<DependenciesPanel repository={repository} />)
    await screen.findByRole('button', { name: /external/i })

    // A repository-list refresh produces a new object for the same repository.
    rerender(<DependenciesPanel repository={{ ...repository }} />)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockedApi.getDependenciesAnalysis).toHaveBeenCalledTimes(1)
  })

  it('re-runs the analysis exactly once when refresh is clicked', async () => {
    const user = userEvent.setup()
    render(<DependenciesPanel repository={repository} />)
    await screen.findByRole('button', { name: /external/i })

    await user.click(screen.getByRole('button', { name: /refresh dependency analysis/i }))
    await waitFor(() => expect(mockedApi.getDependenciesAnalysis).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockedApi.getDependenciesAnalysis).toHaveBeenCalledTimes(2)
  })

  it('never shows one repository’s analysis for another', async () => {
    const other: Repository = { ...repository, id: 'other', name: 'other' }
    mockedApi.getDependenciesAnalysis.mockImplementation((id: string) =>
      id === 'r'
        ? Promise.resolve(structuredClone(analysis))
        : new Promise(() => {}),
    )
    const { rerender } = render(<DependenciesPanel repository={repository} />)
    expect((await screen.findAllByText('a1.py')).length).toBeGreaterThan(0)

    rerender(<DependenciesPanel repository={other} />)

    expect(screen.queryAllByText('a1.py')).toHaveLength(0)
  })
})

describe('DependenciesPanel (A10)', () => {
  it('does not offer the unimplemented graph view', async () => {
    render(<DependenciesPanel repository={repository} />)
    await screen.findByRole('button', { name: /external/i })

    expect(screen.queryByRole('button', { name: /^graph$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/will be implemented/i)).not.toBeInTheDocument()
  })

  it('renders module names as text rather than buttons that do nothing', async () => {
    render(<DependenciesPanel repository={repository} />)
    await screen.findByRole('button', { name: /external/i })

    expect(screen.queryByRole('button', { name: /a1\.py/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('a1.py').length).toBeGreaterThan(0)
  })

  it('"View all" opens the circular dependencies tab', async () => {
    const user = userEvent.setup()
    render(<DependenciesPanel repository={repository} />)

    await user.click(await screen.findByRole('button', { name: /view all 4 circular/i }))

    expect(screen.getByText('cycle 4')).toBeInTheDocument()
  })

  it('has no per-package details button without behaviour', async () => {
    const user = userEvent.setup()
    render(<DependenciesPanel repository={repository} />)

    await user.click(await screen.findByRole('button', { name: /external/i }))

    expect(screen.queryByTitle(/view dependency details/i)).not.toBeInTheDocument()
  })
})
