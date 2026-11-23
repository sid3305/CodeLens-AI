
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  Folder,
  FolderOpen,
  Search,
} from 'lucide-react'

import type { RepositoryFile } from '../../types'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  extension?: string
  children: TreeNode[]
}

interface FileExplorerProps {
  /** Folder (or file) to reveal: it and all its ancestors start expanded. */
  focusPath?: string | null
  files: RepositoryFile[]
  repositoryName: string
  selectedFilePath: string | null
  onSelectFile: (path: string) => void
}

function buildFileTree(files: RepositoryFile[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let currentLevel = root
    let currentPath = ''

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part

      let node = currentLevel.find((item) => item.name === part)

      if (!node) {
        const isFile = index === parts.length - 1

        node = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'folder',
          extension: isFile ? file.extension : undefined,
          children: [],
        }

        currentLevel.push(node)
      }

      currentLevel = node.children
    })
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    nodes.forEach((node) => sortNodes(node.children))
  }

  sortNodes(root)
  return root
}

function FileIcon({ file }: { file: TreeNode }) {
  if (file.type === 'folder') return <Folder size={16} />

  if (['.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.cpp', '.c'].includes(file.extension ?? '')) {
    return <FileCode2 size={16} />
  }

  if (['.json', '.yaml', '.yml', '.toml'].includes(file.extension ?? '')) {
    return <FileJson size={16} />
  }

  return <File size={16} />
}

export default function FileExplorer({
  focusPath = null,
  files,
  repositoryName,
  selectedFilePath,
  onSelectFile,
}: FileExplorerProps) {
  const [expanded, setExpanded] = useState<string[]>(() => {
    if (!focusPath) return []
    const parts = focusPath.split('/').filter(Boolean)
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
  })
  const [query, setQuery] = useState('')

  const tree = useMemo(() => buildFileTree(files), [files])

  const toggleFolder = (path: string) => {
    setExpanded((current) =>
      current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path],
    )
  }

  const renderFiles = (nodes: TreeNode[], depth = 0): ReactNode =>
    nodes.map((file) => {
      const isOpen = expanded.includes(file.path)
      const isFolder = file.type === 'folder'

      if (query) {
        const matches = file.name.toLowerCase().includes(query.toLowerCase())
        const children = renderFiles(file.children, depth + 1)

        if (!matches && file.children.length === 0) return null

        if (!matches && file.children.length > 0) {
          return <div key={file.path}>{children}</div>
        }
      }

      return (
        <div key={file.path}>
          <button
            type="button"
            aria-expanded={isFolder ? isOpen : undefined}
            aria-current={selectedFilePath === file.path ? 'page' : undefined}
            className={`flex h-7 w-full min-w-0 items-center gap-1.5 rounded-sm pr-2 text-left text-sm text-fg-muted hover:bg-surface-hover hover:text-fg ${
              selectedFilePath === file.path ? 'bg-accent-soft font-medium text-accent-text' : ''
            }`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => {
              if (isFolder) {
                toggleFolder(file.path)
              } else {
                onSelectFile(file.path)
              }
            }}
          >
            {isFolder ? (
              isOpen ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )
            ) : (
              <span className="w-3.5 shrink-0" aria-hidden="true" />
            )}

            {isFolder && isOpen ? (
              <FolderOpen size={16} />
            ) : (
              <FileIcon file={file} />
            )}

            <span className="truncate">{file.name}</span>
          </button>

          {isFolder && isOpen && (
            <div>{renderFiles(file.children, depth + 1)}</div>
          )}
        </div>
      )
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

      <div className="px-1">
        {files.length ? (
          renderFiles(tree)
        ) : (
          <p className="px-2 py-2 text-sm text-fg-muted">No repository files loaded.</p>
        )}
      </div>

      <p className="px-2 text-xs text-fg-subtle">{files.length} files</p>
    </div>
  )
}
