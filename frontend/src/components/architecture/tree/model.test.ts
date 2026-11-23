import { describe, expect, it } from 'vitest'

import fixtures from '../../../test/fixtures/dependency-reports.json'
import type { DependenciesAnalysisResponse, Finding } from '../../../types'
import {
  HOTSPOT_COUNT,
  ancestorFolders,
  buildRepositoryTree,
  matchingFiles,
  visibleRows,
  type RepositoryTree,
} from './model'

type FixtureName = keyof typeof fixtures

/** A full response around a fixture report exported from the real backend. */
function reportOf(name: FixtureName): { files: string[]; analysis: DependenciesAnalysisResponse } {
  const { files, report } = fixtures[name]
  const analysis = {
    repository_id: name,
    total_internal_modules: report.analyzed_files.length,
    total_external_dependencies: report.external_dependencies.length,
    dependency_graph_data: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0, showingNodes: 0, showingEdges: 0, folders: [] },
    language_breakdown: {},
    stats: { total_imports: 0, total_calls: 0, circular_import_count: 0, dead_code_count: 0, hotspot_count: 0, file_count: 0 },
    generated_at: '',
    ...report,
  } as unknown as DependenciesAnalysisResponse
  return { files, analysis }
}

const finding = (file: string, severity: string): Finding =>
  ({ id: `${file}:${severity}`, file, severity, title: '', category: '', confidence: '', line: 1, end_line: null, column: null, rule_id: '', description: '', recommendation: '', detected_by: ['Ruff'], tool_details: { tool: 'Ruff' } }) as unknown as Finding

const names = (tree: RepositoryTree, path: string) => tree.byPath.get(path)!.children.map((node) => node.name)

describe('building the tree (X2)', () => {
  it('nests files in their real folders, folders first, natural order', () => {
    const tree = buildRepositoryTree(
      ['src/b.py', 'README.md', 'src/a/z.py', 'src/file10.py', 'src/file2.py', 'docs/guide.md'],
      null,
    )

    expect(tree.roots.map((node) => node.name)).toEqual(['docs', 'src', 'README.md'])
    expect(names(tree, 'src')).toEqual(['a', 'b.py', 'file2.py', 'file10.py'])
    expect(tree.byPath.get('src/a/z.py')!.depth).toBe(2)
    expect(tree.byPath.get('src/a/z.py')!.parent!.path).toBe('src/a')
    expect(tree.folders.sort()).toEqual(['docs', 'src', 'src/a'])
    expect(tree.files).toHaveLength(6)
  })

  it('gives every node a unique DOM-safe id', () => {
    const tree = buildRepositoryTree(['a b/c.py', 'a b/d.py', 'e.py'], null)
    const ids = [...tree.byPath.values()].map((node) => node.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^n\d+$/)
  })

  it('only analysed files carry dependency statistics', () => {
    const { files, analysis } = reportOf('npm_scoped')
    const tree = buildRepositoryTree(files, analysis)

    for (const node of tree.files) {
      expect(node.stats !== null).toBe(analysis.analyzed_files!.includes(node.path))
    }
  })
})

describe('per-file counts match the graph (X2)', () => {
  it('py_cycles: hand-checked against the fixture sources', () => {
    const { files, analysis } = reportOf('py_cycles')
    const tree = buildRepositoryTree(files, analysis)
    const stats = (path: string) => tree.byPath.get(path)!.stats!

    expect(stats('pkg/a.py')).toMatchObject({ imports: ['pkg/b.py'], importers: ['pkg/b.py'], inCycle: true })
    expect(stats('pkg/c.py')).toMatchObject({ imports: ['pkg/d.py'], importers: ['pkg/e.py'], inCycle: true })
    // A self-import is a cycle but not an import of another file.
    expect(stats('pkg/selfref.py')).toMatchObject({ imports: [], importers: [], inCycle: true })
    expect(stats('pkg/leaf.py')).toMatchObject({ imports: [], importers: [], stdlib: ['os'], inCycle: false })
    expect(stats('pkg/__init__.py')).toMatchObject({ imports: [], importers: [], inCycle: false })
  })

  it.each(Object.keys(fixtures) as FixtureName[])('%s: out/in counts equal the edge list', (name) => {
    const { files, analysis } = reportOf(name)
    const tree = buildRepositoryTree(files, analysis)

    // Computed independently from the raw edge list.
    const out = new Map<string, Set<string>>()
    const into = new Map<string, Set<string>>()
    for (const edge of analysis.module_dependencies) {
      if (edge.import_type !== 'internal' || edge.source_module === edge.target_module) continue
      out.set(edge.source_module, (out.get(edge.source_module) ?? new Set()).add(edge.target_module))
      into.set(edge.target_module, (into.get(edge.target_module) ?? new Set()).add(edge.source_module))
    }
    const inCycle = new Set(analysis.circular_dependencies.flatMap((cycle) => cycle.files ?? cycle.cycle))

    for (const path of analysis.analyzed_files!) {
      const stats = tree.byPath.get(path)!.stats!
      expect(stats.imports.length, `${path} imports`).toBe(out.get(path)?.size ?? 0)
      expect(stats.importers.length, `${path} importers`).toBe(into.get(path)?.size ?? 0)
      expect(stats.inCycle, `${path} in cycle`).toBe(inCycle.has(path))
    }
    // Every edge endpoint is a file in the tree.
    for (const edge of analysis.module_dependencies) {
      expect(tree.byPath.get(edge.source_module)?.kind).toBe('file')
      expect(tree.byPath.get(edge.target_module)?.kind).toBe('file')
    }
  })

  it('lists external packages per importing file, never for manifests', () => {
    const { files, analysis } = reportOf('npm_scoped')
    const tree = buildRepositoryTree(files, analysis)

    for (const dependency of analysis.external_dependencies) {
      for (const source of dependency.source_files) {
        const node = tree.byPath.get(source)
        if (analysis.analyzed_files!.includes(source)) expect(node!.stats!.external).toContain(dependency.name)
        else expect(node?.stats ?? null).toBeNull()
      }
    }
  })

  it('counts issues per file with the most severe level', () => {
    const tree = buildRepositoryTree(['a.py', 'b.py'], null, [
      finding('a.py', 'Low'),
      finding('a.py', 'High'),
      finding('a.py', 'medium'),
      finding('gone.py', 'Critical'),
    ])

    expect(tree.byPath.get('a.py')!.stats).toMatchObject({ issues: 3, worst: 'High' })
    expect(tree.byPath.get('b.py')!.stats).toBeNull()
    expect(tree.byPath.has('gone.py')).toBe(false)
  })
})

describe('filters (X2)', () => {
  const { files, analysis } = reportOf('py_cycles')
  const tree = buildRepositoryTree(files, analysis)

  it('no filter and no search keeps everything', () => {
    expect(matchingFiles(tree, 'all', '  ')).toBeNull()
  })

  it('in cycles', () => {
    expect([...matchingFiles(tree, 'cycles', '')!].sort()).toEqual(
      ['pkg/a.py', 'pkg/b.py', 'pkg/c.py', 'pkg/d.py', 'pkg/e.py', 'pkg/selfref.py'],
    )
  })

  it('no importers: analysed files nothing else imports', () => {
    expect([...matchingFiles(tree, 'orphans', '')!].sort()).toEqual(['pkg/__init__.py', 'pkg/leaf.py', 'pkg/selfref.py'])
  })

  it('most dependents keeps the top files and their ties, never files without importers', () => {
    const many = Array.from({ length: 30 }, (_, index) => `m${index}.py`)
    const edges = many.flatMap((target, index) =>
      many.slice(0, index % 15).map((source) => ({ source_module: source, target_module: target, import_type: 'internal', imports: [], edge_count: 1 })),
    )
    const big = buildRepositoryTree(many, { ...analysis, analyzed_files: many, module_dependencies: edges, circular_dependencies: [] })
    const hot = matchingFiles(big, 'hotspots', '')!

    const counts = [...hot].map((path) => big.byPath.get(path)!.stats!.importers.length)
    expect(hot.size).toBeGreaterThanOrEqual(HOTSPOT_COUNT)
    expect(Math.min(...counts)).toBeGreaterThan(0)
    const outside = many.filter((path) => !hot.has(path)).map((path) => big.byPath.get(path)!.stats!.importers.length)
    expect(Math.max(...outside)).toBeLessThan(Math.min(...counts))
  })

  it('search matches any part of the path, case-insensitively, and combines with a filter', () => {
    expect([...matchingFiles(tree, 'all', 'LEAF')!]).toEqual(['pkg/leaf.py'])
    expect([...matchingFiles(tree, 'cycles', 'pkg/c')!]).toEqual(['pkg/c.py'])
    expect(matchingFiles(tree, 'orphans', 'nothing-like-this')!.size).toBe(0)
  })
})

describe('visible rows (X2)', () => {
  const tree = buildRepositoryTree(['src/app/main.py', 'src/app/util.py', 'src/lib.py', 'setup.py'], null)

  it('shows the children of expanded folders only, with sibling positions', () => {
    const rows = visibleRows(tree, new Set(['src']), null)

    expect(rows.map((row) => row.node.path)).toEqual(['src', 'src/app', 'src/lib.py', 'setup.py'])
    expect(rows.map((row) => [row.position, row.setSize])).toEqual([[1, 2], [1, 2], [2, 2], [2, 2]])
  })

  it('with matches, shows only them and the folders holding them', () => {
    const matches = new Set(['src/app/util.py'])
    const rows = visibleRows(tree, ancestorFolders(tree, matches), matches)

    expect(rows.map((row) => row.node.path)).toEqual(['src', 'src/app', 'src/app/util.py'])
    expect(rows.at(-1)).toMatchObject({ position: 1, setSize: 1 })
  })
})

describe('scale (X2)', () => {
  it('builds and flattens 2,000 files quickly', () => {
    const paths = Array.from({ length: 2000 }, (_, index) => `pkg${index % 40}/sub${index % 7}/module_${index}.py`)
    const edges = paths.slice(1).map((path, index) => ({
      source_module: path, target_module: paths[index % 50], import_type: 'internal', imports: [], edge_count: 1,
    }))
    const analysis = {
      ...reportOf('py_cycles').analysis,
      analyzed_files: paths,
      module_dependencies: edges,
      circular_dependencies: [],
      stdlib_imports: [],
      external_dependencies: [],
      unresolved_imports: [],
    }

    const started = performance.now()
    const tree = buildRepositoryTree(paths, analysis)
    const rows = visibleRows(tree, new Set(tree.folders), null)
    const elapsed = performance.now() - started

    expect(tree.files).toHaveLength(2000)
    expect(rows).toHaveLength(2000 + tree.folders.length)
    expect(tree.byPath.get(paths[0])!.stats!.importers.length).toBe(40)
    expect(elapsed).toBeLessThan(500)
  })
})
