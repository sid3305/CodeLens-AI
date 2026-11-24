import { Suspense, useState } from 'react'
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import Sidebar from './Sidebar'
import ThemeToggle from './ThemeToggle'
import { Button, Dialog, Drawer, IconButton, LoadingBlock, useToast } from '../ui'
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'
import { useFocusHeadingOnNavigation } from '../../hooks/useFocusHeadingOnNavigation'

import {
  useAnalysis,
  useDeleteRepository,
  useHealth,
  useRepositories,
  useRepositoryFiles,
} from '../../data/hooks'
import { useActiveJobs, useJobWatcher, useStartJob } from '../../data/jobs'
import { describeAnalysis } from '../../lib/analysis'
import JobProgress from '../jobs/JobProgress'
import { queryKeys } from '../../data/queryClient'
import { api, errorMessage } from '../../services/api'
import type { AnalysisResponse, Job, Repository, WorkspaceSection } from '../../types'
import { paths, sectionFromPath, type NavSection } from '../../app/paths'
import type { ShellContext } from '../../app/shellContext'

const SECTION_TITLES: Record<WorkspaceSection, string> = {
  overview: 'Overview',
  architecture: 'Architecture',
  issues: 'Issues',
  chat: 'Ask AI',
  'file-preview': 'File preview',
}

/**
 * Header, navigation and dialogs around the routed page. The URL is the
 * source of truth for the repository, section, file and filters shown.
 */
export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeSection = sectionFromPath(location.pathname)
  useFocusHeadingOnNavigation(location.pathname, 'main-content')
  const routeRepoId = useMatch('/repo/:repoId/*')?.params.repoId ?? null
  const selectedFilePath = useMatch('/repo/:repoId/files/*')?.params['*'] || null

  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const queryClient = useQueryClient()
  const { notify } = useToast()

  const health = useHealth()
  const apiStatus = health.isPending ? 'checking' : health.isError ? 'offline' : 'online'

  const repositoriesQuery = useRepositories()
  const repositories = repositoriesQuery.data ?? []
  const selectedRepository = repositories.find((repo) => repo.id === routeRepoId) ?? null
  const selectedRepositoryId = selectedRepository?.id ?? null

  // Server state is keyed by repository id, so switching repositories
  // cancels the old requests and never shows another repository's data.
  const files = useRepositoryFiles(selectedRepositoryId).data ?? []
  const analysis = useAnalysis(selectedRepositoryId).data ?? null

  const [explorerFocus, setExplorerFocus] = useState<{ repoId: string; path: string } | null>(null)

  // Imports, analyses and dependency analyses run as background jobs (B3).
  const importZip = useStartJob(api.startZipImportJob)
  const importLink = useStartJob(api.startLinkImportJob)
  const activeJobs = useActiveJobs().data ?? []
  const importJobs = activeJobs.filter((job) => job.kind === 'import')
  const importing = importZip.isPending || importLink.isPending
  // Imports started in this tab open the new repository when they finish.
  const [openWhenImported] = useState(() => new Set<string>())
  const deleteRepository = useDeleteRepository()
  const [deleteTarget, setDeleteTarget] = useState<Repository | null>(null)
  const deleting = deleteRepository.isPending

  /** Keeps the current section when switching (the file preview falls back to Overview). */
  const sectionFor = (section: WorkspaceSection | null): NavSection =>
    section && section !== 'file-preview' ? section : 'overview'
  const repositoryHref = (id: string) => paths.section(id, sectionFor(activeSection))
  const selectRepository = (id: string) => navigate(repositoryHref(id))

  const openFile = (repoId: string, path: string, line: number | null = null) =>
    navigate(paths.file(repoId, path, line))

  /**
   * Go to what an imported link pointed at, in one navigation: a file opens
   * in the preview; a folder opens the Overview with the folder revealed.
   */
  const openImported = async (repoId: string, focusPath: string | null | undefined) => {
    if (focusPath) {
      const listing = await queryClient.fetchQuery({
        queryKey: queryKeys.files(repoId),
        queryFn: ({ signal }) => api.getFiles(repoId, signal),
      })
      if (listing.files.some((file) => file.path === focusPath)) {
        openFile(repoId, focusPath)
        return
      }
      setExplorerFocus({ repoId, path: focusPath })
    }
    navigate(paths.section(repoId, 'overview'))
  }

  const handleImportZip = async (file: File) => {
    try {
      const job = await importZip.mutateAsync(file)
      openWhenImported.add(job.id)
      return true
    } catch (err) {
      notify('error', errorMessage(err, 'ZIP import failed.'))
      return false
    }
  }

  const handleImportGitHub = async (repoUrl: string) => {
    try {
      const job = await importLink.mutateAsync(repoUrl)
      openWhenImported.add(job.id)
      return true
    } catch (err) {
      notify('error', errorMessage(err, 'Import failed.'))
      return false
    }
  }

  useJobWatcher((job: Job) => {
    const repoId = job.repository_id
    if (job.status === 'cancelled') {
      notify('warning', `${job.kind === 'import' ? 'Import' : job.kind === 'analysis' ? 'Analysis' : 'Dependency analysis'} cancelled.`)
      return
    }
    if (job.status === 'failed') {
      notify('error', job.error ?? 'The job failed.')
      return
    }
    if (job.kind === 'analysis' && repoId) {
      const result = job.result as AnalysisResponse
      queryClient.setQueryData(queryKeys.analysis(repoId), result)
      // The static summary is written from these facts.
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.analysis(repoId), 'static-summary'] })
      const outcome = describeAnalysis(result)
      notify(outcome.tone, outcome.message)
    } else if (job.kind === 'dependencies' && repoId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dependencies(repoId) })
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.analysis(repoId), 'static-summary'] })
    } else if (job.kind === 'import') {
      const repository = job.result as Repository
      void queryClient.invalidateQueries({ queryKey: queryKeys.repositories }).then(() => {
        notify('success', `${repository.name}${repository.ref ? ` @ ${repository.ref}` : ''} imported successfully.`)
        if (openWhenImported.delete(job.id)) void openImported(repository.id, repository.focus_path)
      })
    }
  })

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    const target = deleteTarget
    deleteRepository.mutate(target, {
      onSuccess: () => {
        setDeleteTarget(null)
        notify('success', `${target.name} was deleted successfully.`)
        if (target.id === routeRepoId) navigate(paths.home, { replace: true })
      },
      onError: (err) => notify('error', errorMessage(err, 'Unable to delete repository.')),
    })
  }

  const sidebar = (
    <Sidebar
      activeSection={activeSection}
      sectionHref={(section) => (selectedRepositoryId ? paths.section(selectedRepositoryId, section) : null)}
      repositories={repositories}
      selectedRepositoryId={selectedRepositoryId}
      repositoryHref={repositoryHref}
      files={files}
      selectedFilePath={selectedFilePath}
      onSelectFile={(path) => {
        if (selectedRepositoryId) openFile(selectedRepositoryId, path)
      }}
      onImportZip={handleImportZip}
      onImportGitHub={handleImportGitHub}
      activity={
        importJobs.length > 0 &&
        importJobs.map((job) => <JobProgress key={job.id} job={job} label="Import" />)
      }
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

  const shellContext: ShellContext = {
    repositories,
    repositoriesPending: repositoriesQuery.isPending,
    importing,
    onImportZip: handleImportZip,
    onImportLink: handleImportGitHub,
    onOpenFile: openFile,
  }

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      {/* First stop for keyboard users. Moves focus without touching the URL
          hash, which file addresses use for the line (#L12). */}
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
        className="sr-only z-[var(--cl-z-toast)] rounded-sm bg-accent px-3 py-2 text-sm font-medium text-on-accent focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
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
                      onChange={(event) => event.target.value && selectRepository(event.target.value)}
                      className="h-8 max-w-[38vw] truncate rounded-sm border border-transparent bg-transparent pl-1.5 pr-6 text-sm font-medium text-fg hover:border-border-strong sm:max-w-xs"
                    >
                      {!selectedRepository && <option value="" disabled>Choose a repository</option>}
                      {repositories.map((repository) => (
                        <option key={repository.id} value={repository.id}>{repository.name}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="text-fg-muted">No repository</span>
                )}
              </li>
              {selectedRepository && activeSection && (
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
            <Suspense
              fallback={
                <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
                  <LoadingBlock label="Loading page" lines={4} />
                </div>
              }
            >
              <Outlet context={shellContext} />
            </Suspense>
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
