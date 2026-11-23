
import {
  ChevronDown,
  ChevronRight,
  Code2,
  LayoutDashboard,
  Network,
  Bug,
  FolderGit2,
  Search,
  Upload,
  Trash2,
} from 'lucide-react'

import { useState } from 'react'
import type {
  WorkspaceSection,
  Repository,
  RepositoryFile,
} from '../../types'

import FileExplorer from '../explorer/FileExplorer'
import ImportPanel from '../import/ImportPanel'

interface SidebarProps {
  activeSection: WorkspaceSection
  onNavigate: (section: WorkspaceSection) => void

  repositories: Repository[]
  selectedRepositoryId: string | null
  onSelectRepository: (id: string) => void

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
}

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'architecture', label: 'Architecture', icon: Network },
  { id: 'issues', label: 'Issues', icon: Bug },
] as const

export default function Sidebar({
  activeSection,
  onNavigate,
  repositories,
  selectedRepositoryId,
  onSelectRepository,
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
}: SidebarProps) {
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [workspaceOpen, setWorkspaceOpen] = useState(true)
  const [managerOpen, setManagerOpen] = useState(true)
  const [repositorySearch, setRepositorySearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const selectedRepository = repositories.find(
    (repo) => repo.id === selectedRepositoryId,
  )

  const filteredRepositories = repositories.filter((repo) =>
    repo.name.toLowerCase().includes(repositorySearch.toLowerCase()),
  )

  const closeAfter = (task: Promise<boolean | void>) =>
    task.then((ok) => {
      if (ok !== false) setImportOpen(false)
      return ok
    })

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">
          <Code2 size={21} />
        </div>
        <span>CodeLens <strong>AI</strong></span>
      </div>

      <div className="sidebar-content">
        <section>
          <button
            className="sidebar-section-heading"
            onClick={() => setExplorerOpen(!explorerOpen)}
          >
            {explorerOpen ? <ChevronDown /> : <ChevronRight />}
            <span>EXPLORER</span>
          </button>

          {explorerOpen && (
            <FileExplorer
              key={`${selectedRepositoryId ?? ''}:${explorerFocusPath ?? ''}`}
              focusPath={explorerFocusPath}
              files={files}
              repositoryName={selectedRepository?.name ?? ''}
              selectedFilePath={selectedFilePath}
              onSelectFile={onSelectFile}
            />
          )}
        </section>

        <div className="sidebar-divider" />

        <section>
          <button
            className="sidebar-section-heading"
            onClick={() => setWorkspaceOpen(!workspaceOpen)}
          >
            {workspaceOpen ? <ChevronDown /> : <ChevronRight />}
            <span>PROJECT WORKSPACE</span>
          </button>

          {workspaceOpen && (
            <nav className="workspace-navigation" aria-label="Workspace sections">
              {navigation.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => onNavigate(id)}
                  aria-current={activeSection === id ? 'page' : undefined}
                  className={`nav-item ${
                    activeSection === id ? 'active' : ''
                  }`}
                  data-section={id}
                >
                  <Icon size={17} />
                  <span>{label}</span>

                  {id === 'issues' && issueCount !== null && (
                    <span className="nav-count">{issueCount}</span>
                  )}
                </button>
              ))}
            </nav>
          )}
        </section>

        <div className="sidebar-divider" />

        <section>
          <button
            className="sidebar-section-heading"
            onClick={() => setManagerOpen(!managerOpen)}
          >
            {managerOpen ? <ChevronDown /> : <ChevronRight />}
            <span>REPOSITORIES</span>
          </button>

          {managerOpen && (
            <div className="repository-manager">
              <div className="explorer-search">
                <Search size={14} />
                <input
                  value={repositorySearch}
                  onChange={(event) => setRepositorySearch(event.target.value)}
                  placeholder="Search repositories..."
                />
              </div>

              {loading && <small>Loading repositories...</small>}

              {!loading && filteredRepositories.length === 0 && (
                <small>No repositories imported yet.</small>
              )}

              {filteredRepositories.map((repository) => (
              <div
                key={repository.id}
                className={`repository-entry ${
                  selectedRepositoryId === repository.id ? 'file-selected' : ''
                }`}
              >
                <button
                  type="button"
                  className="repository-select-button"
                  onClick={() => onSelectRepository(repository.id)}
                >
                  <FolderGit2 size={17} />
                  <div>
                    <strong>{repository.name}</strong>
                    <small>
                      {repository.source.toUpperCase()} · {repository.file_count} files
                    </small>
                  </div>
                </button>

                <button
                  type="button"
                  className="repository-delete-button"
                  title={`Delete ${repository.name}`}
                  aria-label={`Delete ${repository.name}`}
                  onClick={() => onDeleteRepository(repository)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}

              <div className="sidebar-divider" />

              <button
                type="button"
                className="manager-action"
                aria-expanded={importOpen}
                onClick={() => setImportOpen(!importOpen)}
              >
                <Upload size={15} aria-hidden="true" />
                Import repository
              </button>

              {importOpen && (
                <ImportPanel
                  compact
                  importing={importing}
                  onImportLink={(url) => closeAfter(onImportGitHub(url))}
                  onImportZip={(file) => closeAfter(onImportZip(file))}
                />
              )}
            </div>
          )}
        </section>
      </div>

    </aside>
  )
}
