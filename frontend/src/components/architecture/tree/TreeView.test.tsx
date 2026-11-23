import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import fixtures from '../../../test/fixtures/dependency-reports.json'
import type { DependenciesAnalysisResponse, Finding } from '../../../types'
import { renderWithProviders as render } from '../../../test/render'
import { OpenFileContext } from '../openFile'
import TreeView from './TreeView'

function analysisFor(report: Record<string, unknown>): DependenciesAnalysisResponse {
  return {
    repository_id: 'r',
    total_internal_modules: 0,
    total_external_dependencies: 0,
    dependency_graph_data: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0, showingNodes: 0, showingEdges: 0, folders: [] },
    language_breakdown: {},
    stats: { total_imports: 0, total_calls: 0, circular_import_count: 0, dead_code_count: 0, hotspot_count: 0, file_count: 0 },
    generated_at: '',
    module_dependencies: [],
    external_dependencies: [],
    circular_dependencies: [],
    ...report,
  } as unknown as DependenciesAnalysisResponse
}

const pyCycles = fixtures.py_cycles
const extraFiles = ['README.md', 'docs/guide.md']

function Harness({
  files = [...pyCycles.files, ...extraFiles],
  analysis = analysisFor(pyCycles.report),
  findings = [],
  onOpenFile = vi.fn(),
  initial = null,
}: {
  files?: string[]
  analysis?: DependenciesAnalysisResponse
  findings?: Finding[]
  onOpenFile?: (path: string) => void
  initial?: string | null
}) {
  const [selected, setSelected] = useState<string | null>(initial)
  return (
    <OpenFileContext.Provider value={onOpenFile}>
      <TreeView filePaths={files} analysis={analysis} findings={findings} selectedPath={selected} onSelectFile={setSelected} />
      <output data-testid="selected">{selected ?? ''}</output>
    </OpenFileContext.Provider>
  )
}

const tree = () => screen.getByRole('tree', { name: 'Repository files' })
const item = (name: string | RegExp) => within(tree()).getByRole('treeitem', { name })
const activeName = () => {
  const id = tree().getAttribute('aria-activedescendant')
  return id ? document.getElementById(id)?.getAttribute('aria-label') : null
}

describe('tree semantics (X2)', () => {
  it('is a labelled tree of treeitems with levels, positions and expansion', () => {
    render(<Harness />)

    // Top-level folders start open.
    const pkg = item('pkg')
    expect(pkg).toHaveAttribute('aria-expanded', 'true')
    expect(pkg).toHaveAttribute('aria-level', '1')
    expect(item('guide.md')).toHaveAttribute('aria-level', '2')

    const a = item(/^a\.py,/)
    expect(a).toHaveAttribute('aria-level', '2')
    expect(a).toHaveAttribute('aria-selected', 'false')
    expect(a).not.toHaveAttribute('aria-expanded')
    expect(a.getAttribute('aria-posinset')).toBeTruthy()
    expect(a).toHaveAttribute('aria-setsize', String(pyCycles.files.length))
  })

  it('names each file with its counts, cycle marker and issues', () => {
    const findings = [{ file: 'pkg/a.py', severity: 'High' }, { file: 'pkg/a.py', severity: 'Low' }] as Finding[]
    render(<Harness findings={findings} />)

    expect(item(/^a\.py,/)).toHaveAccessibleName(
      'a.py, imports 1 file, imported by 1 file, in an import cycle, 2 issues, most severe High',
    )
    expect(item(/^leaf\.py,/)).toHaveAccessibleName('leaf.py, imports 0 files, imported by 0 files')
    // Visible too, with text rather than colour alone.
    expect(within(item(/^a\.py,/)).getByText('cycle')).toBeInTheDocument()
    expect(within(item(/^a\.py,/)).getByText('2 issues')).toBeInTheDocument()
  })

  it('files outside the import analysis show no counts', () => {
    render(<Harness />)
    expect(item('README.md')).toHaveAccessibleName('README.md')
  })
})

describe('keyboard (X2)', () => {
  it('arrows, Home/End, Right/Left and Enter follow the tree pattern', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    tree().focus()
    expect(activeName()).toBe('docs')

    await user.keyboard('{ArrowLeft}')
    expect(item('docs')).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowRight}')
    expect(item('docs')).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowRight}')
    expect(activeName()).toBe('guide.md')
    await user.keyboard('{ArrowLeft}')
    expect(activeName()).toBe('docs')
    await user.keyboard('{ArrowLeft}')
    expect(item('docs')).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{End}')
    expect(activeName()).toBe('README.md')
    await user.keyboard('{Home}')
    expect(activeName()).toBe('docs')

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(activeName()).toMatch(/^a\.py,/)
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('selected')).toHaveTextContent('pkg/a.py')
    expect(item(/^a\.py,/)).toHaveAttribute('aria-selected', 'true')
  })

  it('type-ahead jumps to the next name starting with the typed text', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    tree().focus()

    await user.keyboard('le')
    expect(activeName()).toMatch(/^leaf\.py,/)
    await user.keyboard('{Home}')
    await user.keyboard('r')
    expect(activeName()).toBe('README.md')
  })

  it('Space toggles a folder', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    tree().focus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(activeName()).toBe('pkg')

    await user.keyboard(' ')
    expect(item('pkg')).toHaveAttribute('aria-expanded', 'false')
    expect(within(tree()).queryByRole('treeitem', { name: /^a\.py,/ })).not.toBeInTheDocument()
  })
})

describe('filters and actions (X2)', () => {
  it('filters to files in cycles, without importers, or by name', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'In cycles' }))
    expect(screen.getByRole('button', { name: 'In cycles' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(tree()).queryByRole('treeitem', { name: /^leaf\.py,/ })).not.toBeInTheDocument()
    expect(item(/^selfref\.py,/)).toBeInTheDocument()
    expect(screen.getByText(/6 of 10 files match/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'No importers' }))
    expect(item(/^leaf\.py,/)).toBeInTheDocument()
    expect(within(tree()).queryByRole('treeitem', { name: /^a\.py,/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All files' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search files by name' }), 'guide')
    // The match's folder opens even though it was collapsed.
    expect(item('guide.md')).toBeInTheDocument()
    expect(within(tree()).getAllByRole('treeitem')).toHaveLength(2)
  })

  it('says so when nothing matches, with a way back', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByRole('searchbox', { name: 'Search files by name' }), 'zzz')
    expect(screen.queryByRole('tree')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all files' }))
    expect(tree()).toBeInTheDocument()
  })

  it('expands and collapses everything', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(within(tree()).queryByRole('treeitem', { name: 'guide.md' })).not.toBeInTheDocument()
    expect(within(tree()).getAllByRole('treeitem').map((node) => node.getAttribute('aria-label'))).toEqual(['docs', 'pkg', 'README.md'])

    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(item('guide.md')).toBeInTheDocument()
    expect(item(/^a\.py,/)).toBeInTheDocument()
  })
})

describe('side panel (X2)', () => {
  it('lists imports and importers; internal imports open the preview', async () => {
    const onOpenFile = vi.fn()
    const user = userEvent.setup()
    render(<Harness onOpenFile={onOpenFile} />)

    await user.click(item(/^c\.py,/))
    const panel = screen.getByRole('region', { name: 'c.py' })
    expect(within(panel).getByText('In an import cycle')).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Open pkg/d.py' }))
    expect(onOpenFile).toHaveBeenCalledWith('pkg/d.py')

    await user.click(within(panel).getByRole('button', { name: 'Open in file preview' }))
    expect(onOpenFile).toHaveBeenLastCalledWith('pkg/c.py')
  })

  it('shows stdlib, external and unresolved imports by kind', async () => {
    const user = userEvent.setup()
    const analysis = analysisFor({
      ...pyCycles.report,
      external_dependencies: [
        { name: 'requests', source_files: ['pkg/leaf.py', 'requirements.txt'], import_count: 1, language: 'python', version: null, is_dev_dependency: false },
      ],
      unresolved_imports: [{ file: 'pkg/leaf.py', line: 4, specifier: '.missing', language: 'python', reason: 'No such module' }],
    })
    render(<Harness analysis={analysis} />)

    await user.click(item(/^leaf\.py,/))
    const panel = screen.getByRole('region', { name: 'leaf.py' })
    const imports = within(panel).getByRole('heading', { name: /imports \(3\)/i }).parentElement!

    expect(within(imports).getByText('os').previousSibling).toHaveTextContent('stdlib')
    expect(within(imports).getByText('requests').previousSibling).toHaveTextContent('package')
    expect(within(imports).getByText('.missing').previousSibling).toHaveTextContent('unresolved')
    expect(within(imports).getByText(/line 4 · No such module/)).toBeInTheDocument()
  })

  it('jumps to an importer in the tree, clearing a filter that hides it', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByRole('searchbox', { name: 'Search files by name' }), 'pkg/c')
    await user.click(item(/^c\.py,/))
    await user.click(screen.getByRole('button', { name: 'Show pkg/e.py in the tree' }))

    expect(screen.getByTestId('selected')).toHaveTextContent('pkg/e.py')
    expect(screen.getByRole('searchbox', { name: 'Search files by name' })).toHaveValue('')
    expect(item(/^e\.py,/)).toHaveAttribute('aria-selected', 'true')
    expect(activeName()).toMatch(/^e\.py,/)
  })

  it('opens the folders of a file selected from the URL', () => {
    render(<Harness initial="docs/guide.md" />)

    expect(item('guide.md')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'guide.md' })).toHaveTextContent(/not part of the import analysis/)
  })
})

describe('virtualisation (X2)', () => {
  it('renders only the rows in view for 2,000 files and still reaches the last one', async () => {
    const files = Array.from({ length: 2000 }, (_, index) => `src/module_${String(index).padStart(4, '0')}.py`)
    const user = userEvent.setup()
    render(<Harness files={files} analysis={analysisFor({ analyzed_files: files })} />)

    const rendered = within(tree()).getAllByRole('treeitem')
    expect(rendered.length).toBeLessThan(60)

    tree().focus()
    await user.keyboard('{End}')
    expect(activeName()).toMatch(/^module_1999\.py,/)
    expect(within(tree()).getAllByRole('treeitem').length).toBeLessThan(60)
  })
})
