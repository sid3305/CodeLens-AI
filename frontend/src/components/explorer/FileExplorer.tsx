
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
            className={`file-row ${
              selectedFilePath === file.path ? 'file-selected' : ''
            }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
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
              <span className="file-chevron-space" />
            )}

            {isFolder && isOpen ? (
              <FolderOpen size={16} />
            ) : (
              <FileIcon file={file} />
            )}

            <span>{file.name}</span>
          </button>

          {isFolder && isOpen && (
            <div>{renderFiles(file.children, depth + 1)}</div>
          )}
        </div>
      )
    })

  return (
    <div className="file-explorer">
      <div className="explorer-repository">
        <Folder size={15} />
        <span>{repositoryName || 'No repository selected'}</span>
      </div>

      <div className="explorer-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a file..."
        />
      </div>

      <div className="file-tree">
        {files.length ? (
          renderFiles(tree)
        ) : (
          <p style={{ padding: '12px', fontSize: '12px', opacity: 0.65 }}>
            No repository files loaded.
          </p>
        )}
      </div>

      <div className="explorer-note">
        {files.length} source files
      </div>
    </div>
  )
}
