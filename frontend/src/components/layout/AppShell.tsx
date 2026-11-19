
import { useCallback, useEffect, useState } from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
} from 'lucide-react'

import Sidebar from './Sidebar'
import WorkspacePanel from './WorkspacePanel'
import AIAssistant from './AIAssistant'

import { api } from '../../services/api'
import type {
  WorkspaceSection,
  Repository,
  RepositoryFile,
  AnalysisResponse,
} from '../../types'

type Theme = 'light' | 'dark'

export default function AppShell() {
  const [activeSection, setActiveSection] =
    useState<WorkspaceSection>('overview')

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [assistantCollapsed, setAssistantCollapsed] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')

  const [repositories, setRepositories] = useState<Repository[]>([])
  const [selectedRepositoryId, setSelectedRepositoryId] =
    useState<string | null>(null)

  const [files, setFiles] = useState<RepositoryFile[]>([])
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Repository | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedLine, setSelectedLine] = useState<number | null>(null)

  const selectedRepository =
    repositories.find((repo) => repo.id === selectedRepositoryId) ?? null

  const loadRepositories = useCallback(async () => {
    try {
      const data = await api.getRepositories()
      setRepositories(data)

      setSelectedRepositoryId((current) => {
        if (current && data.some((repo) => repo.id === current)) {
          return current
        }

        return data[0]?.id ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load repositories.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRepositories()
  }, [loadRepositories])

  useEffect(() => {
    if (!selectedRepositoryId) {
      setFiles([])
      setAnalysis(null)
      setSelectedFilePath(null)
      setSelectedFileContent(null)
      setSelectedLine(null)
      return
    }

    let cancelled = false

    async function loadRepositoryData() {
      setError(null)
      setAnalysis(null)
      setSelectedFilePath(null)
      setSelectedFileContent(null)

      try {
        const [fileResponse, analysisResponse] = await Promise.all([
          api.getFiles(selectedRepositoryId!),
          api.getAnalysisResults(selectedRepositoryId!).catch(() => null),
        ])

        if (cancelled) return

        setFiles(fileResponse.files)
        setAnalysis(analysisResponse)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load repository data.',
          )
        }
      }
    }

    void loadRepositoryData()

    return () => {
      cancelled = true
    }
  }, [selectedRepositoryId])

  const handleImportZip = async (file: File) => {
    setImporting(true)
    setError(null)
    setNotice(null)

    try {
      const repository = await api.uploadRepository(file)

      await loadRepositories()
      setSelectedRepositoryId(repository.id)
      setNotice(`${repository.name} imported successfully.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ZIP import failed.')
    } finally {
      setImporting(false)
    }
  }

  const handleImportGitHub = async (repoUrl: string) => {
    setImporting(true)
    setError(null)
    setNotice(null)

    try {
      const repository = await api.importGitHub(repoUrl)

      await loadRepositories()
      setSelectedRepositoryId(repository.id)
      setNotice(`${repository.name} imported successfully.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub import failed.')
    } finally {
      setImporting(false)
    }
  }

  const handleRunAnalysis = async () => {
    if (!selectedRepositoryId) return

    setAnalyzing(true)
    setError(null)
    setNotice(null)
    setSelectedLine(null)

    try {
      const result = await api.analyzeRepository(selectedRepositoryId)
      setAnalysis(result)
      setNotice('Repository analysis completed successfully.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSelectFile = async (
  path: string,
  lineNumber: number | null = null,
) => {
  if (!selectedRepositoryId) return

  setSelectedFilePath(path)
  setSelectedLine(lineNumber)
  setSelectedFileContent(null)
  setError(null)
  setActiveSection('file-preview')

  try {
    const result = await api.getFileContent(selectedRepositoryId, path)
    setSelectedFileContent(result.content)
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Unable to read file.')
  }
}

  const handleConfirmDelete = async () => {
  if (!deleteTarget) return

  setDeleting(true)
  setError(null)

  try {
    await api.deleteRepository(deleteTarget.id)

    const remainingRepositories = repositories.filter(
      (repo) => repo.id !== deleteTarget.id,
    )

    setRepositories(remainingRepositories)

    if (selectedRepositoryId === deleteTarget.id) {
      setSelectedRepositoryId(remainingRepositories[0]?.id ?? null)
    }

    setDeleteTarget(null)
    setNotice(`${deleteTarget.name} was deleted successfully.`)
  } catch (err) {
    setError(
      err instanceof Error ? err.message : 'Unable to delete repository.',
    )
  } finally {
    setDeleting(false)
  }
}

  return (
    <div className="app-shell" data-theme={theme}>
      {!sidebarCollapsed && (
        <Sidebar
          activeSection={activeSection}
          onNavigate={(section) => {
            setSelectedFilePath(null)
            setSelectedFileContent(null)
            setSelectedLine(null)
            setActiveSection(section)
          }}
          repositories={repositories}
          selectedRepositoryId={selectedRepositoryId}
          onSelectRepository={setSelectedRepositoryId}
          files={files}
          selectedFilePath={selectedFilePath}
          onSelectFile={handleSelectFile}
          onImportZip={handleImportZip}
          onImportGitHub={handleImportGitHub}
          onDeleteRepository={(repository) => setDeleteTarget(repository)}
          importing={importing}
          loading={loading}
        />
      )}

      <div className="main-area">
        <header className="top-toolbar">
          <button
            className="icon-button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Open sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>

          <div className="toolbar-repository">
            {selectedRepository?.name ?? 'No repository selected'}
            <span>/</span>
            <strong>Workspace</strong>
          </div>

          <div className="toolbar-status">
            <span className="status-dot" />
            {loading ? 'Connecting...' : 'API connected'}
          </div>

          <div className="appearance-switcher">
            <button
              className={theme === 'light' ? 'selected' : ''}
              onClick={() => setTheme('light')}
              title="Light mode"
              aria-label="Switch to light mode"
            >
              <Sun size={15} />
              <span>Light</span>
            </button>

            <button
              className={theme === 'dark' ? 'selected' : ''}
              onClick={() => setTheme('dark')}
              title="Dark mode"
              aria-label="Switch to dark mode"
            >
              <Moon size={15} />
              <span>Dark</span>
            </button>
          </div>
        </header>

        {(error || notice) && (
          <div
            role="status"
            style={{
              padding: '10px 18px',
              color: error ? '#dc2626' : '#15803d',
              background: error ? '#fee2e2' : '#dcfce7',
              fontSize: '13px',
            }}
          >
            {error ?? notice}
            <button
              onClick={() => {
                setError(null)
                setNotice(null)
              }}
              style={{
                float: 'right',
                border: 0,
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        )}

        <div className="workspace-layout">
          <WorkspacePanel
            activeSection={activeSection}
            repository={selectedRepository}
            files={files}
            analysis={analysis}
            selectedFilePath={selectedFilePath}
            selectedFileContent={selectedFileContent}
            onRunAnalysis={handleRunAnalysis}
            analyzing={analyzing}
            onRefresh={loadRepositories}
            onImportZip={handleImportZip}
            onImportGitHub={handleImportGitHub}
            selectedLine={selectedLine}
            onOpenFinding={handleSelectFile}  
          />

          <AIAssistant
            collapsed={assistantCollapsed}
            onToggle={() => setAssistantCollapsed(!assistantCollapsed)}
          />
        </div>
            </div>

      {deleteTarget && (
        <div className="modal-backdrop">
          <div className="confirmation-modal">
            <h2>Delete repository?</h2>

            <p>
              Are you sure you want to delete{' '}
              <strong>{deleteTarget.name}</strong>?
              This will permanently remove its files and analysis results.
            </p>

            <div className="modal-actions">
              <button
                className="secondary-button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>

              <button
                className="danger-button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
              >
                {deleting ? 'Deleting...' : 'Delete Repository'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
