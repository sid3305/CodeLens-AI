import { useId, useMemo, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-react'

import type { DependenciesAnalysisResponse, Finding } from '../../../types'
import { Button, EmptyState, cn } from '../../ui'
import FileDetails from './FileDetails'
import RepositoryTree from './RepositoryTree'
import {
  HOTSPOT_COUNT,
  ancestorFolders,
  buildRepositoryTree,
  matchingFiles,
  visibleRows,
  type TreeFilter,
} from './model'

const FILTERS: { id: TreeFilter; label: string; description: string }[] = [
  { id: 'all', label: 'All files', description: 'Every file in the repository' },
  { id: 'cycles', label: 'In cycles', description: 'Files that are part of an import cycle' },
  { id: 'orphans', label: 'No importers', description: 'Analysed files no other file imports' },
  { id: 'hotspots', label: 'Most dependents', description: `The ${HOTSPOT_COUNT} files imported by the most other files` },
]

/**
 * The repository's real folder structure with dependency counts per file.
 * `selectedPath` is kept by the page (in the URL).
 */
export default function TreeView({
  filePaths,
  analysis,
  findings,
  selectedPath,
  onSelectFile,
}: {
  filePaths: string[]
  analysis: DependenciesAnalysisResponse
  findings: Finding[]
  selectedPath: string | null
  onSelectFile: (path: string | null) => void
}) {
  const searchId = useId()
  const tree = useMemo(() => buildRepositoryTree(filePaths, analysis, findings), [filePaths, analysis, findings])

  const [filter, setFilter] = useState<TreeFilter>('all')
  const [query, setQuery] = useState('')
  const matches = useMemo(() => matchingFiles(tree, filter, query), [tree, filter, query])

  // Top-level folders start open; a selected file's folders are opened too.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set(tree.roots.filter((node) => node.kind === 'folder').map((node) => node.path))
    if (selectedPath) for (const folder of ancestorFolders(tree, [selectedPath])) initial.add(folder)
    return initial
  })
  // While filtering, the folders holding matches open (once per filter).
  const [filterKey, setFilterKey] = useState('all:')
  const currentKey = `${filter}:${query.trim().toLowerCase()}`
  if (currentKey !== filterKey) {
    setFilterKey(currentKey)
    if (matches) setExpanded((current) => new Set([...current, ...ancestorFolders(tree, matches)]))
  }

  const [reveal, setReveal] = useState<{ path: string } | null>(null)
  const rows = useMemo(() => visibleRows(tree, expanded, matches), [tree, expanded, matches])

  const toggle = (path: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (open) next.add(path)
      else next.delete(path)
      return next
    })

  /** Select a file and show it in the tree: clear filters hiding it, open its folders. */
  const jumpTo = (path: string) => {
    if (matches && !matches.has(path)) {
      setFilter('all')
      setQuery('')
    }
    setExpanded((current) => new Set([...current, ...ancestorFolders(tree, [path])]))
    setReveal({ path })
    onSelectFile(path)
  }

  const selectedNode = selectedPath ? tree.byPath.get(selectedPath) ?? null : null
  const fileCount = tree.files.length
  const shownFiles = matches ? matches.size : fileCount

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-48 flex-1">
          <label htmlFor={searchId} className="sr-only">Search files by name</label>
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files by name"
            className="h-9 w-full rounded-sm border border-border-strong bg-surface pl-8 pr-2 text-sm text-fg placeholder:text-fg-subtle"
          />
        </div>
        <div className="flex gap-1">
          <Button size="sm" icon={<ChevronsUpDown size={14} aria-hidden="true" />} onClick={() => setExpanded(new Set(tree.folders))}>
            Expand all
          </Button>
          <Button size="sm" icon={<ChevronsDownUp size={14} aria-hidden="true" />} onClick={() => setExpanded(new Set())}>
            Collapse all
          </Button>
        </div>
      </div>

      <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            title={item.description}
            onClick={() => setFilter(item.id)}
            className={cn(
              'h-8 rounded-sm border px-3 text-sm font-medium',
              filter === item.id
                ? 'border-transparent bg-accent text-on-accent'
                : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="text-sm text-fg-muted" role="status">
        {matches ? `${shownFiles} of ${fileCount} files match` : `${fileCount} files`}
        <span className="text-fg-subtle"> · ↗ imports · ↙ imported by (files in this repository)</span>
      </p>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="min-w-0">
          {rows.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title="No files match"
              description="Try another filter or search."
              action={
                <Button size="sm" onClick={() => { setFilter('all'); setQuery('') }}>
                  Show all files
                </Button>
              }
            />
          ) : (
            <RepositoryTree
              label="Repository files"
              rows={rows}
              expanded={expanded}
              selectedPath={selectedPath}
              onToggle={toggle}
              onSelectFile={(path) => onSelectFile(path)}
              reveal={reveal}
            />
          )}
        </div>
        <FileDetails node={selectedNode} onJump={jumpTo} onClose={() => onSelectFile(null)} />
      </div>
    </div>
  )
}
