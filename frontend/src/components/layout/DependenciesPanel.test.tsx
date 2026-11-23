import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import DependenciesPanel from './DependenciesPanel'
import { api, type DependenciesAnalysisResponse } from '../../services/api'

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

const repository = { id: 'r', name: 'repo', source: 'zip' }

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
