import {
  Bug,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  LayoutDashboard,
  Network,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router'
import type { ReactNode } from 'react'

import type { Repository, RepositoryFile, WorkspaceSection } from '../../types'
import type { NavSection } from '../../app/paths'
import { LogoMark } from '../brand/Logo'
import FileExplorer from '../explorer/FileExplorer'
import ImportPanel from '../import/ImportPanel'
import { Button, IconButton, cn } from '../ui'

interface SidebarProps {
  /** The section shown, or null outside a repository. */
  activeSection: WorkspaceSection | null
  /** Where a section link goes; null while no repository is open. */
  sectionHref: (section: NavSection) => string | null

  repositories: Repository[]
  selectedRepositoryId: string | null
  repositoryHref: (id: string) => string

  files: RepositoryFile[]
  selectedFilePath: string | null
  onSelectFile: (path: string) => void

  onImportZip: (file: File) => Promise<boolean | void>
  onImportGitHub: (url: string) => Promise<boolean | void>
  /** Folder or file to reveal in the explorer (from a link import). */
  explorerFocusPath?: string | null
  onDeleteRepository: (repository: Repository) => void

  importing: boolean
  loading: boolean
  /** Number of findings from the latest analysis, or null if none ran yet. */
  issueCount: number | null
  /** Called after any navigation, so an off-canvas drawer can close. */
  onNavigated?: () => void
}

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'architecture', label: 'Architecture', icon: Network },
  { id: 'issues', label: 'Issues', icon: Bug },
] as const

export default function Sidebar({
  activeSection,
  sectionHref,
  repositories,
  selectedRepositoryId,
  repositoryHref,
  files,
  selectedFilePath,
  onSelectFile,
  onImportZip,
  onImportGitHub,
  onDeleteRepository,
  importing,
  loading,
  issueCount,
  explorerFocusPath = null,
  onNavigated,
}: SidebarProps) {
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [workspaceOpen, setWorkspaceOpen] = useState(true)
  const [managerOpen, setManagerOpen] = useState(true)
  const [repositorySearch, setRepositorySearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const selectedRepository = repositories.find((repo) => repo.id === selectedRepositoryId)

  const filteredRepositories = repositories.filter((repo) =>
    repo.name.toLowerCase().includes(repositorySearch.toLowerCase()),
  )

  const closeAfter = (task: Promise<boolean | void>) =>
    task.then((ok) => {
      if (ok !== false) {
        setImportOpen(false)
        onNavigated?.()
      }
      return ok
    })

  const selectFile = (path: string) => {
    onSelectFile(path)
    onNavigated?.()
  }

  return (
    <aside aria-label="Workspace navigation" className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <LogoMark size={32} />
        <span className="text-md font-semibold tracking-tight">
          CodeLens <span className="text-accent-text">AI</span>
        </span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        <SidebarSection title="Workspace" open={workspaceOpen} onToggle={() => setWorkspaceOpen(!workspaceOpen)}>
          <nav aria-label="Workspace sections">
            <ul className="space-y-0.5">
              {navigation.map(({ id, label, icon: Icon }) => {
                const href = sectionHref(id)
                const active = activeSection === id
                const content = (
                  <>
                    <Icon size={16} aria-hidden="true" />
                    <span>{label}</span>
                    {id === 'issues' && issueCount !== null && (
                      <span className="ml-auto rounded-sm bg-surface-2 px-1.5 text-xs font-medium tabular-nums text-fg-muted">
                        <span className="sr-only">(</span>{issueCount}<span className="sr-only"> findings)</span>
                      </span>
                    )}
                  </>
                )
                const base = 'flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-base'
                return (
                  <li key={id}>
                    {href ? (
                      <Link
                        to={href}
                        onClick={onNavigated}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          base,
                          'text-fg-muted hover:bg-surface-hover hover:text-fg',
                          active && 'bg-accent-soft font-medium text-accent-text hover:bg-accent-soft hover:text-accent-text',
                        )}
                      >
                        {content}
                      </Link>
                    ) : (
                      // No repository open: nothing to navigate to yet.
                      <span aria-disabled="true" className={cn(base, 'text-fg-subtle')}>
                        {content}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </nav>
        </SidebarSection>

        <SidebarSection title="Repositories" open={managerOpen} onToggle={() => setManagerOpen(!managerOpen)}>
          <div className="space-y-2">
            {repositories.length > 3 && (
              <div className="relative px-1">
                <label htmlFor="repository-search" className="sr-only">Search repositories</label>
                <Search
                  size={14}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle"
                />
                <input
                  id="repository-search"
                  type="search"
                  value={repositorySearch}
                  onChange={(event) => setRepositorySearch(event.target.value)}
                  placeholder="Search repositories"
                  className="h-8 w-full rounded-sm border border-border-strong bg-surface pl-7 pr-2 text-sm text-fg placeholder:text-fg-subtle"
                />
              </div>
            )}

            {loading && <p className="px-2 text-sm text-fg-muted" role="status">Loading repositories…</p>}
            {!loading && filteredRepositories.length === 0 && (
              <p className="px-2 text-sm text-fg-muted">No repositories imported yet.</p>
            )}

            <ul className="space-y-0.5">
              {filteredRepositories.map((repository) => {
                const selected = selectedRepositoryId === repository.id
                const ref = repository.ref
                  ? repository.ref.length > 20 ? repository.ref.slice(0, 7) : repository.ref
                  : null
                return (
                  <li
                    key={repository.id}
                    className={cn(
                      'flex items-center gap-1 rounded-sm pr-1 hover:bg-surface-hover',
                      selected && 'bg-surface-2',
                    )}
                  >
                    <Link
                      to={repositoryHref(repository.id)}
                      aria-current={selected ? 'true' : undefined}
                      onClick={onNavigated}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                    >
                      <FolderGit2 size={16} aria-hidden="true" className="shrink-0 text-fg-muted" />
                      <span className="min-w-0">
                        <span className={cn('block truncate text-sm text-fg', selected && 'font-semibold')}>
                          {repository.name}
                        </span>
                        <span className="block truncate text-xs text-fg-subtle">
                          {repository.source === 'github' ? 'GitHub' : 'ZIP'}
                          {ref ? ` · ${ref}` : ''} · {repository.file_count} files
                        </span>
                      </span>
                    </Link>
                    <IconButton
                      size="sm"
                      aria-label={`Delete ${repository.name}`}
                      icon={<Trash2 size={14} />}
                      onClick={() => onDeleteRepository(repository)}
                    />
                  </li>
                )
              })}
            </ul>

            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              icon={<Upload size={14} aria-hidden="true" />}
              aria-expanded={importOpen}
              onClick={() => setImportOpen(!importOpen)}
            >
              Import repository
            </Button>

            {importOpen && (
              <div className="px-1">
                <ImportPanel
                  compact
                  importing={importing}
                  onImportLink={(url) => closeAfter(onImportGitHub(url))}
                  onImportZip={(file) => closeAfter(onImportZip(file))}
                />
              </div>
            )}
          </div>
        </SidebarSection>

        {selectedRepository && (
          <SidebarSection title="Files" open={explorerOpen} onToggle={() => setExplorerOpen(!explorerOpen)}>
            <FileExplorer
              key={`${selectedRepositoryId ?? ''}:${explorerFocusPath ?? ''}`}
              focusPath={explorerFocusPath}
              files={files}
              repositoryName={selectedRepository.name}
              selectedFilePath={selectedFilePath}
              onSelectFile={selectFile}
            />
          </SidebarSection>
        )}
      </div>
    </aside>
  )
}

function SidebarSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const contentId = useId()

  return (
    <section>
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex w-full items-center gap-1 rounded-sm px-2 py-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg"
        >
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          {title}
        </button>
      </h2>
      <div id={contentId} hidden={!open} className="mt-1">
        {open && children}
      </div>
    </section>
  )
}
