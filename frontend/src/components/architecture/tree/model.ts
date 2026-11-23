import { SEVERITIES, normaliseSeverity, type Severity } from '../../ui/severity'
import type { DependenciesAnalysisResponse, Finding, UnresolvedImport } from '../../../types'

/** What the dependency analysis knows about one file. */
export interface FileStats {
  /** Internal files this file imports (the graph's out-edges, self excluded). */
  imports: string[]
  /** Internal files that import this file (the graph's in-edges, self excluded). */
  importers: string[]
  external: string[]
  stdlib: string[]
  unresolved: UnresolvedImport[]
  inCycle: boolean
  issues: number
  /** Most severe finding in the file, or null without findings. */
  worst: Severity | null
}

export interface TreeNode {
  /** Stable DOM-safe id (`n<index>`). */
  id: string
  path: string
  name: string
  kind: 'folder' | 'file'
  parent: TreeNode | null
  depth: number
  children: TreeNode[]
  /** Files only, and only for files the dependency analysis covered. */
  stats: FileStats | null
}

export interface RepositoryTree {
  roots: TreeNode[]
  byPath: Map<string, TreeNode>
  /** Every folder path, for "expand all". */
  folders: string[]
  files: TreeNode[]
}

const compareNodes = (a: TreeNode, b: TreeNode) =>
  a.kind !== b.kind
    ? a.kind === 'folder' ? -1 : 1
    : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

function emptyStats(): FileStats {
  return { imports: [], importers: [], external: [], stdlib: [], unresolved: [], inCycle: false, issues: 0, worst: null }
}

/**
 * Build the folder/file hierarchy with per-file dependency statistics.
 * Every input is visited once through Maps; only sibling sorting is
 * O(n log n).
 */
export function buildRepositoryTree(
  filePaths: string[],
  analysis: DependenciesAnalysisResponse | null,
  findings: Finding[] = [],
): RepositoryTree {
  const byPath = new Map<string, TreeNode>()
  const roots: TreeNode[] = []
  const folders: string[] = []
  const files: TreeNode[] = []
  let counter = 0

  const nodeFor = (path: string, kind: TreeNode['kind']): TreeNode => {
    const existing = byPath.get(path)
    if (existing) return existing

    const slash = path.lastIndexOf('/')
    const parent = slash === -1 ? null : nodeFor(path.slice(0, slash), 'folder')
    const node: TreeNode = {
      id: `n${counter++}`,
      path,
      name: path.slice(slash + 1),
      kind,
      parent,
      depth: parent ? parent.depth + 1 : 0,
      children: [],
      stats: null,
    }
    byPath.set(path, node)
    ;(parent ? parent.children : roots).push(node)
    if (kind === 'folder') folders.push(path)
    else files.push(node)
    return node
  }

  const statsFor = (path: string): FileStats => {
    const node = nodeFor(path, 'file')
    node.stats ??= emptyStats()
    return node.stats
  }

  for (const path of filePaths) nodeFor(path, 'file')

  if (analysis) {
    // Every analysed file has stats, even with no imports at all.
    const analysed = new Set(analysis.analyzed_files ?? [])
    for (const path of analysed) statsFor(path)
    for (const edge of analysis.module_dependencies) {
      if (edge.import_type !== 'internal' || edge.source_module === edge.target_module) continue
      statsFor(edge.source_module).imports.push(edge.target_module)
      statsFor(edge.target_module).importers.push(edge.source_module)
    }
    for (const dependency of analysis.external_dependencies) {
      for (const source of dependency.source_files) {
        // Manifests (requirements.txt, package.json) declare packages; they do not import them.
        if (analysed.has(source)) statsFor(source).external.push(dependency.name)
      }
    }
    for (const module of analysis.stdlib_imports ?? []) {
      for (const source of module.source_files) statsFor(source).stdlib.push(module.name)
    }
    for (const item of analysis.unresolved_imports ?? []) statsFor(item.file).unresolved.push(item)
    for (const cycle of analysis.circular_dependencies) {
      for (const path of cycle.files?.length ? cycle.files : cycle.cycle) statsFor(path).inCycle = true
    }
  }

  const rank = (severity: Severity) => SEVERITIES.indexOf(severity)
  for (const finding of findings) {
    const node = byPath.get(finding.file)
    if (!node || node.kind !== 'file') continue
    const stats = (node.stats ??= emptyStats())
    stats.issues += 1
    const severity = normaliseSeverity(finding.severity)
    if (stats.worst === null || rank(severity) < rank(stats.worst)) stats.worst = severity
  }

  const sortAll = (nodes: TreeNode[]) => {
    nodes.sort(compareNodes)
    for (const node of nodes) if (node.children.length) sortAll(node.children)
  }
  sortAll(roots)
  for (const node of files) {
    if (!node.stats) continue
    node.stats.imports.sort()
    node.stats.importers.sort()
    node.stats.external.sort()
    node.stats.stdlib.sort()
  }

  return { roots, byPath, folders, files }
}

// --- Filters -----------------------------------------------------------------

export type TreeFilter = 'all' | 'cycles' | 'orphans' | 'hotspots'

export const HOTSPOT_COUNT = 10

/**
 * Files kept by a filter and a name search, or null when nothing filters.
 * - cycles: files in an import cycle
 * - orphans: analysed files no other file imports
 * - hotspots: the HOTSPOT_COUNT files with the most importers (ties kept)
 */
export function matchingFiles(tree: RepositoryTree, filter: TreeFilter, query: string): Set<string> | null {
  const needle = query.trim().toLowerCase()
  if (filter === 'all' && !needle) return null

  let candidates = tree.files
  if (filter === 'cycles') candidates = candidates.filter((node) => node.stats?.inCycle)
  if (filter === 'orphans') candidates = candidates.filter((node) => node.stats && node.stats.importers.length === 0)
  if (filter === 'hotspots') {
    const ranked = candidates
      .filter((node) => (node.stats?.importers.length ?? 0) > 0)
      .sort((a, b) => b.stats!.importers.length - a.stats!.importers.length)
    const threshold = ranked[Math.min(HOTSPOT_COUNT, ranked.length) - 1]?.stats!.importers.length ?? Infinity
    candidates = ranked.filter((node) => node.stats!.importers.length >= threshold)
  }
  if (needle) candidates = candidates.filter((node) => node.path.toLowerCase().includes(needle))

  return new Set(candidates.map((node) => node.path))
}

/** The folders containing any of the given files (to show matches expanded). */
export function ancestorFolders(tree: RepositoryTree, paths: Iterable<string>): Set<string> {
  const result = new Set<string>()
  for (const path of paths) {
    for (let node = tree.byPath.get(path)?.parent ?? null; node && !result.has(node.path); node = node.parent) {
      result.add(node.path)
    }
  }
  return result
}

// --- Flattening --------------------------------------------------------------

export interface VisibleRow {
  node: TreeNode
  /** 1-based position among the visible siblings, and their count (aria-posinset / setsize). */
  position: number
  setSize: number
}

/**
 * The rows to render, in order: children of expanded folders only, and
 * with a filter only matching files and the folders that contain them.
 */
export function visibleRows(tree: RepositoryTree, expanded: Set<string>, matches: Set<string> | null): VisibleRow[] {
  const keep = matches ? ancestorFolders(tree, matches) : null
  const rows: VisibleRow[] = []

  const walk = (nodes: TreeNode[]) => {
    const shown = keep ? nodes.filter((node) => (node.kind === 'folder' ? keep.has(node.path) : matches!.has(node.path))) : nodes
    shown.forEach((node, index) => {
      rows.push({ node, position: index + 1, setSize: shown.length })
      if (node.kind === 'folder' && expanded.has(node.path)) walk(node.children)
    })
  }
  walk(tree.roots)
  return rows
}
