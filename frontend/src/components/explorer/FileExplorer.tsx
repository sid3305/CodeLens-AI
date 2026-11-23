import { useMemo, useState } from 'react'
import { Folder, Search } from 'lucide-react'

import type { RepositoryFile } from '../../types'
import RepositoryTree from '../architecture/tree/RepositoryTree'
import { ancestorFolders, buildRepositoryTree, matchingFiles, visibleRows } from '../architecture/tree/model'

interface FileExplorerProps {
  /** Folder (or file) to reveal: it and all its ancestors start expanded. */
  focusPath?: string | null
  files: RepositoryFile[]
  repositoryName: string
  selectedFilePath: string | null
  onSelectFile: (path: string) => void
}

/**
 * The repository's files as an accessible, virtualised tree (the same
 * component as the Architecture tree, without dependency statistics).
 */
export default function FileExplorer({
  focusPath = null,
  files,
  repositoryName,
  selectedFilePath,
  onSelectFile,
}: FileExplorerProps) {
  const tree = useMemo(() => buildRepositoryTree(files.map((file) => file.path), null), [files])
  const [query, setQuery] = useState('')

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    if (focusPath) {
      // The focus may be a folder (reveal it open) or a file.
      const parts = focusPath.split('/').filter(Boolean)
      parts.forEach((_, index) => initial.add(parts.slice(0, index + 1).join('/')))
    }
    if (selectedFilePath) for (const folder of ancestorFolders(tree, [selectedFilePath])) initial.add(folder)
    return initial
  })

  const matches = useMemo(() => matchingFiles(tree, 'all', query), [tree, query])
  // While searching, every folder holding a match is open.
  const shownExpanded = useMemo(
    () => (matches ? new Set([...expanded, ...ancestorFolders(tree, matches)]) : expanded),
    [expanded, matches, tree],
  )
  const rows = useMemo(() => visibleRows(tree, shownExpanded, matches), [tree, shownExpanded, matches])

  const toggle = (path: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (open) next.add(path)
      else next.delete(path)
      return next
    })

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 truncate px-2 text-sm font-medium text-fg">
        <Folder size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
        <span className="truncate">{repositoryName || 'No repository selected'}</span>
      </p>
      <div className="relative px-2">
        <label htmlFor="file-search" className="sr-only">Find a file</label>
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-4.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
        <input
          id="file-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a file"
          className="h-8 w-full rounded-sm border border-border-strong bg-surface pl-7 pr-2 text-sm text-fg placeholder:text-fg-subtle"
        />
      </div>
      {rows.length === 0 ? (
        <p className="px-2 text-sm text-fg-muted" role="status">
          {files.length === 0 ? 'No files.' : 'No files match.'}
        </p>
      ) : (
        <div className="px-1">
          <RepositoryTree
            label="Files"
            rows={rows}
            expanded={shownExpanded}
            selectedPath={selectedFilePath}
            onToggle={toggle}
            onSelectFile={onSelectFile}
            maxHeight={420}
          />
        </div>
      )}
      <p className="px-2 text-xs text-fg-subtle">{files.length} files</p>
    </div>
  )
}
