
import {
  ChevronDown,
  ChevronRight,
  Code2,
  LayoutDashboard,
  Network,
  Workflow,
  Package,
  Bug,
  Gauge,
  BookOpen,
  Sparkles,
  FileText,
  FolderGit2,
  Settings,
  Plus,
  Search,
  Upload,
  Trash2,
} from 'lucide-react'

import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type {
  WorkspaceSection,
  Repository,
  RepositoryFile,
} from '../../types'

import FileExplorer from '../explorer/FileExplorer'

interface SidebarProps {
  activeSection: WorkspaceSection
  onNavigate: (section: WorkspaceSection) => void

  repositories: Repository[]
  selectedRepositoryId: string | null
  onSelectRepository: (id: string) => void

  files: RepositoryFile[]
  selectedFilePath: string | null
  onSelectFile: (path: string) => void

  onImportZip: (file: File) => Promise<void>
  onImportGitHub: (url: string) => Promise<void>
  onDeleteRepository: (repository: Repository) => void

  importing: boolean
  loading: boolean
}

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'architecture', label: 'Architecture', icon: Network },
  { id: 'data-flow', label: 'Data Flow', icon: Workflow },
  { id: 'dependencies', label: 'Dependencies', icon: Package },
  { id: 'issues', label: 'Issues', icon: Bug },
  { id: 'performance', label: 'Performance', icon: Gauge },
  { id: 'documentation', label: 'Documentation & Tests', icon: BookOpen },
  { id: 'code-improvements', label: 'Code Improvements', icon: Sparkles },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'file-preview', label: 'File Preview', icon: FileText },
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
}: SidebarProps) {
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [workspaceOpen, setWorkspaceOpen] = useState(true)
  const [managerOpen, setManagerOpen] = useState(true)
  const [repositorySearch, setRepositorySearch] = useState('')

  const zipInputRef = useRef<HTMLInputElement>(null)

  const selectedRepository = repositories.find(
    (repo) => repo.id === selectedRepositoryId,
  )

  const filteredRepositories = repositories.filter((repo) =>
    repo.name.toLowerCase().includes(repositorySearch.toLowerCase()),
  )

  const handleGitHubImport = async () => {
    const url = window.prompt('Enter the public GitHub repository URL:')

    if (!url?.trim()) return

    await onImportGitHub(url.trim())
  }

  const handleZipChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]

    if (file) {
      await onImportZip(file)
      event.target.value = ''
    }
  }

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
            <nav className="workspace-navigation">
              {navigation.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => onNavigate(id)}
                  className={`nav-item ${
                    activeSection === id ? 'active' : ''
                  }`}
                  data-section={id}
                >
                  <Icon size={17} />
                  <span>{label}</span>

                  {id === 'issues' && (
                    <span className="nav-count">—</span>
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
            <Plus size={15} className="section-action" />
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

              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                hidden
                onChange={handleZipChange}
              />

              <button
                className="manager-action"
                disabled={importing}
                onClick={() => zipInputRef.current?.click()}
              >
                <Upload size={15} />
                {importing ? 'Importing...' : 'Import ZIP'}
              </button>

              <button
                className="manager-action"
                disabled={importing}
                onClick={handleGitHubImport}
              >
                <Code2 size={15} />
                Import from GitHub
              </button>
            </div>
          )}
        </section>
      </div>

      <button className="sidebar-settings">
        <Settings size={17} />
        <span>Workspace Settings</span>
      </button>
    </aside>
  )
}
