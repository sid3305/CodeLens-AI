
import { useCallback, useEffect, useState } from 'react'
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import Sidebar from './Sidebar'
import ThemeToggle from './ThemeToggle'
import WorkspacePanel from './WorkspacePanel'
import { Button, Dialog, Drawer, IconButton, useToast } from '../ui'
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'

import { api, errorMessage } from '../../services/api'
import { describeAnalysis } from '../../lib/analysis'
import type {
  WorkspaceSection,
  Repository,
  RepositoryFile,
  AnalysisResponse,
} from '../../types'

type ApiStatus = 'checking' | 'online' | 'offline'

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

  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [repositories, setRepositories] = useState<Repository[]>([])
  const [selectedRepositoryId, setSelectedRepositoryId] =
    useState<string | null>(null)

  // Data is stored with the id it belongs to and only used while that id
  // is selected, so switching repositories never shows stale data and
  // late responses for a previous selection are ignored.
  const [repositoryData, setRepositoryData] = useState<RepositoryData | null>(null)
  const [fileSelection, setFileSelection] = useState<FileSelection | null>(null)
  const [explorerFocus, setExplorerFocus] = useState<{ repoId: string; path: string } | null>(null)

  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const { notify } = useToast()
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
      notify('error', errorMessage(err, 'Unable to load repositories.'))
    } finally {
      setLoading(false)
    }
  }, [applyRepositories, notify])

  useEffect(() => {
    let cancelled = false

    api
      .getRepositories()
      .then(
        (data) => {
          if (!cancelled) applyRepositories(data)
        },
        (err: unknown) => {
          if (!cancelled) notify('error', errorMessage(err, 'Unable to load repositories.'))
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [applyRepositories, notify])

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
        if (!cancelled) notify('error', errorMessage(err, 'Unable to load repository data.'))
      },
    )

    return () => {
      cancelled = true
    }
  }, [selectedRepositoryId, notify])

  const selectRepository = (id: string | null) => {
    setSelectedRepositoryId(id)
  }

  const handleImportZip = async (file: File) => {
    setImporting(true)

    try {
      const repository = await api.uploadRepository(file)

      await loadRepositories()
      selectRepository(repository.id)
      notify('success', `${repository.name} imported successfully.`)
      return true
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'ZIP import failed.')
      return false
    } finally {
      setImporting(false)
    }
  }

  const handleImportGitHub = async (repoUrl: string) => {
    setImporting(true)

    try {
      const repository = await api.importGitHub(repoUrl)

      await loadRepositories()
      selectRepository(repository.id)
      notify(
        'success',
        `${repository.name}${repository.ref ? ` @ ${repository.ref}` : ''} imported successfully.`,
      )
      if (repository.focus_path) await openFocus(repository.id, repository.focus_path)
      return true
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'GitHub import failed.')
      return false
    } finally {
      setImporting(false)
    }
  }

  /** Open what a link pointed at: a file in the preview, a folder in the explorer. */
  const openFocus = async (repoId: string, focusPath: string) => {
    const listing = await api.getFiles(repoId)
    if (listing.files.some((file) => file.path === focusPath)) {
      await handleSelectFile(focusPath, null, repoId)
    } else {
      setExplorerFocus({ repoId, path: focusPath })
    }
  }

  const handleRunAnalysis = async () => {
    if (!selectedRepositoryId) return

    const repoId = selectedRepositoryId
    setAnalyzing(true)
    setFileSelection((current) => (current ? { ...current, line: null } : current))

    try {
      const result = await api.analyzeRepository(repoId)
      const outcome = describeAnalysis(result)
      setRepositoryData((current) =>
        current && current.repoId === repoId
          ? { ...current, analysis: result }
          : current,
      )
      notify(outcome.tone, outcome.message)
    } catch (err) {
      notify('error', errorMessage(err, 'Analysis failed.'))
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSelectFile = async (
    path: string,
    lineNumber: number | null = null,
    repoIdOverride: string | null = null,
  ) => {
    const repoId = repoIdOverride ?? selectedRepositoryId
    if (!repoId) return

    const isStillSelected = (current: FileSelection | null): current is FileSelection =>
      current !== null && current.repoId === repoId && current.path === path

    setFileSelection({ repoId, path, line: lineNumber, content: null })
    setActiveSection('file-preview')

    try {
      const result = await api.getFileContent(repoId, path)
      // Ignore the response if another file was selected meanwhile.
      setFileSelection((current) =>
        isStillSelected(current) ? { ...current, content: result.content } : current,
      )
    } catch (err) {
      notify('error', errorMessage(err, 'Unable to read file.'))
    }
  }

  const handleConfirmDelete = async () => {
  if (!deleteTarget) return

  setDeleting(true)

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
    notify('success', `${deleteTarget.name} was deleted successfully.`)
  } catch (err) {
    notify('error', 
      err instanceof Error ? err.message : 'Unable to delete repository.',
    )
  } finally {
    setDeleting(false)
  }
}

  const sectionTitle = {
    overview: 'Overview',
    architecture: 'Architecture',
    issues: 'Issues',
    'file-preview': 'File preview',
  }[activeSection]

  const sidebar = (
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
      explorerFocusPath={
        explorerFocus && explorerFocus.repoId === selectedRepositoryId
          ? explorerFocus.path
          : null
      }
      onNavigated={isDesktop ? undefined : () => setDrawerOpen(false)}
    />
  )

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      {isDesktop && sidebarOpen && (
        <div className="sticky top-0 h-screen w-72 shrink-0 border-r border-border">{sidebar}</div>
      )}

      {!isDesktop && (
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Navigation">
          {sidebar}
        </Drawer>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[var(--cl-z-header)] flex h-14 items-center gap-2 border-b border-border bg-surface px-2 sm:px-3">
          {isDesktop ? (
            <IconButton
              aria-label={sidebarOpen ? 'Hide navigation' : 'Show navigation'}
              aria-expanded={sidebarOpen}
              icon={sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            />
          ) : (
            <IconButton
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              aria-haspopup="dialog"
              icon={<Menu size={18} />}
              onClick={() => setDrawerOpen(true)}
            />
          )}

          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-1.5 text-sm">
              <li className="min-w-0">
                {repositories.length > 0 ? (
                  <>
                    <label htmlFor="repository-switcher" className="sr-only">Repository</label>
                    <select
                      id="repository-switcher"
                      value={selectedRepositoryId ?? ''}
                      onChange={(event) => selectRepository(event.target.value)}
                      className="h-8 max-w-[38vw] truncate rounded-sm border border-transparent bg-transparent pl-1.5 pr-6 text-sm font-medium text-fg hover:border-border-strong sm:max-w-xs"
                    >
                      {repositories.map((repository) => (
                        <option key={repository.id} value={repository.id}>{repository.name}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="text-fg-muted">No repository</span>
                )}
              </li>
              {selectedRepository && (
                <>
                  <li aria-hidden="true" className="text-fg-subtle">/</li>
                  <li aria-current="page" className="truncate font-medium text-fg">{sectionTitle}</li>
                </>
              )}
            </ol>
          </nav>

          <p className="inline-flex items-center gap-1.5 text-sm text-fg-muted" role="status">
            <span
              aria-hidden="true"
              className={
                apiStatus === 'online'
                  ? 'size-2 rounded-full bg-success'
                  : apiStatus === 'offline'
                    ? 'size-2 rounded-full bg-danger'
                    : 'size-2 rounded-full bg-fg-subtle'
              }
            />
            <span className={apiStatus === 'offline' ? undefined : 'sr-only sm:not-sr-only'}>
              {apiStatus === 'checking'
                ? 'Checking API…'
                : apiStatus === 'online'
                  ? 'API connected'
                  : 'API unreachable'}
            </span>
          </p>

          <ThemeToggle />
        </header>

        {/* Room for a future right-hand assistant drawer; nothing is rendered there yet. */}
        <div className="flex min-w-0 flex-1">
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
            <WorkspacePanel
              activeSection={activeSection}
              repository={selectedRepository}
              files={files}
              analysis={analysis}
              selectedFilePath={selectedFilePath}
              selectedFileContent={selectedFileContent}
              onRunAnalysis={handleRunAnalysis}
              analyzing={analyzing}
              onImportZip={handleImportZip}
              onImportGitHub={handleImportGitHub}
              importing={importing}
              selectedLine={selectedLine}
              onOpenFinding={handleSelectFile}
            />
          </main>
        </div>
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        dismissible={!deleting}
        title="Delete repository?"
        description={
          deleteTarget && (
            <>
              <strong className="text-fg">{deleteTarget.name}</strong> and its analysis results will be
              permanently removed. This cannot be undone.
            </>
          )
        }
        footer={
          <>
            <Button disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={() => void handleConfirmDelete()}>
              Delete repository
            </Button>
          </>
        }
      />
    </div>
  )
}
