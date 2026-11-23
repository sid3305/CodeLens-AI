import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import Sidebar from './Sidebar'
import ThemeToggle from './ThemeToggle'
import { Button, Dialog, Drawer, IconButton, LoadingBlock, useToast } from '../ui'
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'

import {
  useAnalysis,
  useDeleteRepository,
  useHealth,
  useImportLink,
  useImportZip,
  useRepositories,
  useRepositoryFiles,
} from '../../data/hooks'
import { queryKeys } from '../../data/queryClient'
import { api, errorMessage } from '../../services/api'
import type { Repository, WorkspaceSection } from '../../types'
import type { FindingFilters } from '../workspace/findingFilters'
import ArchitecturePage from '../../pages/ArchitecturePage'
import FilePreviewPage from '../../pages/FilePreviewPage'
import IssuesPage from '../../pages/IssuesPage'
import OverviewPage from '../../pages/OverviewPage'
import WelcomePage from '../../pages/WelcomePage'

/** The previewed file, tagged with its repository. */
interface FileSelection {
  repoId: string
  path: string
  line: number | null
}

const DEFAULT_FILTERS: FindingFilters = { query: '', severity: 'All', analyzer: 'All' }

const SECTION_TITLES: Record<WorkspaceSection, string> = {
  overview: 'Overview',
  architecture: 'Architecture',
  issues: 'Issues',
  'file-preview': 'File preview',
}

export default function AppShell() {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('overview')

  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const queryClient = useQueryClient()
  const { notify } = useToast()

  const health = useHealth()
  const apiStatus = health.isPending ? 'checking' : health.isError ? 'offline' : 'online'

  const repositoriesQuery = useRepositories()
  const repositories = repositoriesQuery.data ?? []
  const [chosenRepositoryId, setChosenRepositoryId] = useState<string | null>(null)
  // Falls back to the first repository when the chosen one is gone.
  const selectedRepository =
    repositories.find((repo) => repo.id === chosenRepositoryId) ?? repositories[0] ?? null
  const selectedRepositoryId = selectedRepository?.id ?? null

  // Server state is keyed by repository id (query keys) and so are the
  // selections below: switching repositories cancels the old requests and
  // never shows another repository's data.
  const files = useRepositoryFiles(selectedRepositoryId).data ?? []
  const analysis = useAnalysis(selectedRepositoryId).data ?? null

  const [fileSelection, setFileSelection] = useState<FileSelection | null>(null)
  const [explorerFocus, setExplorerFocus] = useState<{ repoId: string; path: string } | null>(null)
  const [filters, setFilters] = useState<{ repoId: string; value: FindingFilters } | null>(null)

  const currentFile =
    fileSelection && fileSelection.repoId === selectedRepositoryId ? fileSelection : null
  const selectedFilePath = currentFile?.path ?? null
  const currentFilters =
    filters && filters.repoId === selectedRepositoryId ? filters.value : DEFAULT_FILTERS

  const importZip = useImportZip()
  const importLink = useImportLink()
  const importing = importZip.isPending || importLink.isPending
  const deleteRepository = useDeleteRepository()
  const [deleteTarget, setDeleteTarget] = useState<Repository | null>(null)
  const deleting = deleteRepository.isPending

  const selectRepository = (id: string | null) => setChosenRepositoryId(id)

  const handleSelectFile = (
    path: string,
    line: number | null = null,
    repoId: string | null = selectedRepositoryId,
  ) => {
    if (!repoId) return
    setFileSelection({ repoId, path, line })
    setActiveSection('file-preview')
  }

  /** Open what a link pointed at: a file in the preview, a folder in the explorer. */
  const openFocus = async (repoId: string, focusPath: string) => {
    const listing = await queryClient.fetchQuery({
      queryKey: queryKeys.files(repoId),
      queryFn: ({ signal }) => api.getFiles(repoId, signal),
    })
    if (listing.files.some((file) => file.path === focusPath)) {
      handleSelectFile(focusPath, null, repoId)
    } else {
      setExplorerFocus({ repoId, path: focusPath })
    }
  }

  const handleImportZip = async (file: File) => {
    try {
      const repository = await importZip.mutateAsync(file)
      selectRepository(repository.id)
      notify('success', `${repository.name} imported successfully.`)
      return true
    } catch (err) {
      notify('error', errorMessage(err, 'ZIP import failed.'))
      return false
    }
  }

  const handleImportGitHub = async (repoUrl: string) => {
    try {
      const repository = await importLink.mutateAsync(repoUrl)
      selectRepository(repository.id)
      notify(
        'success',
        `${repository.name}${repository.ref ? ` @ ${repository.ref}` : ''} imported successfully.`,
      )
      if (repository.focus_path) await openFocus(repository.id, repository.focus_path)
      return true
    } catch (err) {
      notify('error', errorMessage(err, 'Import failed.'))
      return false
    }
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    const target = deleteTarget
    deleteRepository.mutate(target, {
      onSuccess: () => {
        setDeleteTarget(null)
        notify('success', `${target.name} was deleted successfully.`)
      },
      onError: (err) => notify('error', errorMessage(err, 'Unable to delete repository.')),
    })
  }

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
      onSelectFile={(path) => handleSelectFile(path)}
      onImportZip={handleImportZip}
      onImportGitHub={handleImportGitHub}
      onDeleteRepository={(repository) => setDeleteTarget(repository)}
      importing={importing}
      loading={repositoriesQuery.isPending}
      issueCount={analysis ? analysis.findings.length : null}
      explorerFocusPath={
        explorerFocus && explorerFocus.repoId === selectedRepositoryId ? explorerFocus.path : null
      }
      onNavigated={isDesktop ? undefined : () => setDrawerOpen(false)}
    />
  )

  let page
  if (!selectedRepository) {
    page = repositoriesQuery.isPending ? (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <LoadingBlock label="Loading repositories" lines={3} />
      </div>
    ) : (
      <WelcomePage importing={importing} onImportLink={handleImportGitHub} onImportZip={handleImportZip} />
    )
  } else if (activeSection === 'overview') {
    page = <OverviewPage key={selectedRepository.id} repository={selectedRepository} />
  } else if (activeSection === 'architecture') {
    page = (
      <ArchitecturePage
        key={selectedRepository.id}
        repository={selectedRepository}
        onOpenFile={(path) => handleSelectFile(path)}
      />
    )
  } else if (activeSection === 'issues') {
    page = (
      <IssuesPage
        key={selectedRepository.id}
        repository={selectedRepository}
        filters={currentFilters}
        onFiltersChange={(value) => setFilters({ repoId: selectedRepository.id, value })}
        onOpenFinding={(path, line) => handleSelectFile(path, line)}
      />
    )
  } else {
    page = (
      <FilePreviewPage
        key={`${selectedRepository.id}:${selectedFilePath ?? ''}`}
        repository={selectedRepository}
        path={selectedFilePath}
        line={currentFile?.line ?? null}
      />
    )
  }

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
                  <li aria-current="page" className="truncate font-medium text-fg">
                    {SECTION_TITLES[activeSection]}
                  </li>
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

        {repositoriesQuery.isError && (
          <p role="alert" className="border-b border-border bg-danger-soft px-4 py-2 text-sm text-danger">
            {errorMessage(repositoriesQuery.error, 'Unable to load repositories.')}
          </p>
        )}

        <div className="flex min-w-0 flex-1">
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
            {page}
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
            <Button variant="danger" loading={deleting} onClick={handleConfirmDelete}>
              Delete repository
            </Button>
          </>
        }
      />
    </div>
  )
}
