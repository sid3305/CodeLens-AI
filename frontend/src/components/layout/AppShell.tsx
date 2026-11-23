
import { useCallback, useEffect, useState } from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
} from 'lucide-react'

import Sidebar from './Sidebar'
import WorkspacePanel from './WorkspacePanel'

import { api, errorMessage } from '../../services/api'
import { describeAnalysis, type MessageTone } from '../../lib/analysis'
import type {
  WorkspaceSection,
  Repository,
  RepositoryFile,
  AnalysisResponse,
} from '../../types'

type Theme = 'light' | 'dark'
type ApiStatus = 'checking' | 'online' | 'offline'

interface Notice {
  tone: MessageTone
  text: string
}

const HEALTH_CHECK_INTERVAL_MS = 30_000

/** Files and latest analysis, tagged with the repository they belong to. */
interface RepositoryData {
  repoId: string
  files: RepositoryFile[]
  analysis: AnalysisResponse | null
}

/** The previewed file, tagged with its repository. */
interface FileSelection {
  repoId: string
  path: string
  line: number | null
  content: string | null
}

export default function AppShell() {
  const [activeSection, setActiveSection] =
    useState<WorkspaceSection>('overview')

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')

  const [repositories, setRepositories] = useState<Repository[]>([])
  const [selectedRepositoryId, setSelectedRepositoryId] =
    useState<string | null>(null)

  // Data is stored with the id it belongs to and only used while that id
  // is selected, so switching repositories never shows stale data and
  // late responses for a previous selection are ignored.
  const [repositoryData, setRepositoryData] = useState<RepositoryData | null>(null)
  const [fileSelection, setFileSelection] = useState<FileSelection | null>(null)

  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
  const [deleteTarget, setDeleteTarget] = useState<Repository | null>(null)
  const [deleting, setDeleting] = useState(false)

  const selectedRepository =
    repositories.find((repo) => repo.id === selectedRepositoryId) ?? null

  const currentData =
    repositoryData && repositoryData.repoId === selectedRepositoryId
      ? repositoryData
      : null
  const files = currentData?.files ?? []
  const analysis = currentData?.analysis ?? null

  const currentFile =
    fileSelection && fileSelection.repoId === selectedRepositoryId
      ? fileSelection
      : null
  const selectedFilePath = currentFile?.path ?? null
  const selectedFileContent = currentFile?.content ?? null
  const selectedLine = currentFile?.line ?? null

  const applyRepositories = useCallback((data: Repository[]) => {
    setRepositories(data)
    setSelectedRepositoryId((current) =>
      current && data.some((repo) => repo.id === current)
        ? current
        : data[0]?.id ?? null,
    )
  }, [])

  const loadRepositories = useCallback(async () => {
    try {
      applyRepositories(await api.getRepositories())
    } catch (err) {
      setError(errorMessage(err, 'Unable to load repositories.'))
    } finally {
      setLoading(false)
    }
  }, [applyRepositories])

  useEffect(() => {
    let cancelled = false

    api
      .getRepositories()
      .then(
        (data) => {
          if (!cancelled) applyRepositories(data)
        },
        (err: unknown) => {
          if (!cancelled) setError(errorMessage(err, 'Unable to load repositories.'))
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [applyRepositories])

  useEffect(() => {
    let cancelled = false

    const checkHealth = () => {
      api.health().then(
        () => {
          if (!cancelled) setApiStatus('online')
        },
        () => {
          if (!cancelled) setApiStatus('offline')
        },
      )
    }

    checkHealth()
    const timer = window.setInterval(checkHealth, HEALTH_CHECK_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!selectedRepositoryId) return

    const repoId = selectedRepositoryId
    let cancelled = false

    Promise.all([
      api.getFiles(repoId),
      api.getAnalysisResults(repoId).catch(() => null),
    ]).then(
      ([fileResponse, analysisResponse]) => {
        if (!cancelled) {
          setRepositoryData({
            repoId,
            files: fileResponse.files,
            analysis: analysisResponse,
          })
        }
      },
      (err: unknown) => {
        if (!cancelled) setError(errorMessage(err, 'Unable to load repository data.'))
      },
    )

    return () => {
      cancelled = true
    }
  }, [selectedRepositoryId])

  const selectRepository = (id: string | null) => {
    setError(null)
    setSelectedRepositoryId(id)
  }

  const handleImportZip = async (file: File) => {
    setImporting(true)
    setError(null)
    setNotice(null)

    try {
      const repository = await api.uploadRepository(file)

      await loadRepositories()
      selectRepository(repository.id)
      setNotice({ tone: 'success', text: `${repository.name} imported successfully.` })
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
      selectRepository(repository.id)
      setNotice({ tone: 'success', text: `${repository.name} imported successfully.` })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub import failed.')
    } finally {
      setImporting(false)
    }
  }

  const handleRunAnalysis = async () => {
    if (!selectedRepositoryId) return

    const repoId = selectedRepositoryId
    setAnalyzing(true)
    setError(null)
    setNotice(null)
    setFileSelection((current) => (current ? { ...current, line: null } : current))

    try {
      const result = await api.analyzeRepository(repoId)
      const outcome = describeAnalysis(result)
      setRepositoryData((current) =>
        current && current.repoId === repoId
          ? { ...current, analysis: result }
          : current,
      )
      setNotice({ tone: outcome.tone, text: outcome.message })
    } catch (err) {
      setError(errorMessage(err, 'Analysis failed.'))
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSelectFile = async (
    path: string,
    lineNumber: number | null = null,
  ) => {
    if (!selectedRepositoryId) return

    const repoId = selectedRepositoryId
    const isStillSelected = (current: FileSelection | null): current is FileSelection =>
      current !== null && current.repoId === repoId && current.path === path

    setFileSelection({ repoId, path, line: lineNumber, content: null })
    setError(null)
    setActiveSection('file-preview')

    try {
      const result = await api.getFileContent(repoId, path)
      // Ignore the response if another file was selected meanwhile.
      setFileSelection((current) =>
        isStillSelected(current) ? { ...current, content: result.content } : current,
      )
    } catch (err) {
      setError(errorMessage(err, 'Unable to read file.'))
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
      selectRepository(remainingRepositories[0]?.id ?? null)
    }

    setDeleteTarget(null)
    setNotice({ tone: 'success', text: `${deleteTarget.name} was deleted successfully.` })
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
            setFileSelection(null)
            setActiveSection(section)
          }}
          repositories={repositories}
          selectedRepositoryId={selectedRepositoryId}
          onSelectRepository={selectRepository}
          files={files}
          selectedFilePath={selectedFilePath}
          onSelectFile={handleSelectFile}
          onImportZip={handleImportZip}
          onImportGitHub={handleImportGitHub}
          onDeleteRepository={(repository) => setDeleteTarget(repository)}
          importing={importing}
          loading={loading}
          issueCount={analysis ? analysis.findings.length : null}
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
            <span className={`status-dot ${apiStatus}`} aria-hidden="true" />
            {apiStatus === 'checking'
              ? 'Checking API…'
              : apiStatus === 'online'
                ? 'API connected'
                : 'API unreachable'}
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
            className={`status-banner ${error ? 'error' : notice?.tone}`}
            role={error || notice?.tone === 'error' ? 'alert' : 'status'}
          >
            <span>{error ?? notice?.text}</span>
            <button
              type="button"
              className="status-banner-dismiss"
              aria-label="Dismiss message"
              onClick={() => {
                setError(null)
                setNotice(null)
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
