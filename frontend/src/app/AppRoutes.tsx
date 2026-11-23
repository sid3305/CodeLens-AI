import { lazy, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'

import AppShell from '../components/layout/AppShell'
import { LoadingBlock } from '../components/ui'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { NotFoundPage, RepositoryNotFoundPage } from '../pages/NotFoundPage'
import {
  ARCHITECTURE_VIEWS,
  DEFAULT_ARCHITECTURE_VIEW,
  architectureSearch,
  type ArchitectureView,
} from '../pages/architectureViews'
import { filtersFromSearch, filtersToSearch, lineFromHash, paths } from './paths'
import { useRepositoryContext, useShell, type RepositoryContext } from './shellContext'

// Pages are split out of the initial bundle and loaded on first visit.
const OverviewPage = lazy(() => import('../pages/OverviewPage'))
const ArchitecturePage = lazy(() => import('../pages/ArchitecturePage'))
const IssuesPage = lazy(() => import('../pages/IssuesPage'))
const FilePreviewPage = lazy(() => import('../pages/FilePreviewPage'))
const WelcomePage = lazy(() => import('../pages/WelcomePage'))

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <LoadingBlock label="Loading page" lines={4} />
    </div>
  )
}

/** `/`: the first repository, or the welcome page when there is none. */
function HomeRoute() {
  const shell = useShell()
  useDocumentTitle(null)
  // An import started here navigates on its own (possibly to a file); the
  // redirect to the first repository must not race it.
  const [importStarted, setImportStarted] = useState(false)
  const track =
    <A,>(run: (arg: A) => Promise<boolean>) =>
    async (arg: A) => {
      setImportStarted(true)
      const ok = await run(arg)
      if (!ok) setImportStarted(false)
      return ok
    }

  if (shell.repositoriesPending) return <PageFallback />
  const first = shell.repositories[0]
  if (first && !importStarted) return <Navigate to={paths.section(first.id, 'overview')} replace />
  return (
    <WelcomePage
      importing={shell.importing}
      onImportLink={track(shell.onImportLink)}
      onImportZip={track(shell.onImportZip)}
    />
  )
}

/** `/repo/:repoId/*`: resolves the repository or explains that it does not exist. */
function RepositoryRoute() {
  const shell = useShell()
  const { repoId = '' } = useParams()
  const repository = shell.repositories.find((repo) => repo.id === repoId)

  if (!repository) {
    return shell.repositoriesPending ? <PageFallback /> : <RepositoryNotFoundPage repoId={repoId} />
  }
  const context: RepositoryContext = { ...shell, repository }
  return <Outlet context={context} />
}

function OverviewRoute() {
  const { repository } = useRepositoryContext()
  useDocumentTitle('Overview', repository.name)
  return <OverviewPage key={repository.id} repository={repository} />
}

function ArchitectureRoute() {
  const { repository, onOpenFile } = useRepositoryContext()
  const [params, setParams] = useSearchParams()
  useDocumentTitle('Architecture', repository.name)

  const requested = params.get('view') as ArchitectureView | null
  const view = requested && ARCHITECTURE_VIEWS.includes(requested) ? requested : DEFAULT_ARCHITECTURE_VIEW
  const file = params.get('file')

  return (
    <ArchitecturePage
      key={repository.id}
      repository={repository}
      view={view}
      onViewChange={(next) => setParams(architectureSearch(next, file))}
      selectedFile={view === 'tree' ? file : null}
      // Selecting files in the tree is browsing within the view: replace, do not stack history.
      onSelectFile={(path) => setParams(architectureSearch('tree', path), { replace: true })}
      onOpenFile={(path) => onOpenFile(repository.id, path)}
    />
  )
}

function IssuesRoute() {
  const { repository, onOpenFile } = useRepositoryContext()
  const [params, setParams] = useSearchParams()
  useDocumentTitle('Issues', repository.name)

  const filters = filtersFromSearch(params)
  return (
    <IssuesPage
      key={repository.id}
      repository={repository}
      filters={filters}
      // Typing in the search box replaces the entry; choosing a filter adds one.
      onFiltersChange={(next) => setParams(filtersToSearch(next), { replace: next.query !== filters.query })}
      onOpenFinding={(path, line) => onOpenFile(repository.id, path, line)}
    />
  )
}

function FileRoute() {
  const { repository } = useRepositoryContext()
  const navigate = useNavigate()
  const params = useParams()
  const { hash } = useLocation()
  const path = params['*'] || null
  useDocumentTitle(path ? path.split('/').pop() : 'File preview', repository.name)

  return (
    <FilePreviewPage
      key={`${repository.id}:${path ?? ''}`}
      repository={repository}
      path={path}
      line={lineFromHash(hash)}
      // Clicking a line number updates #L<line> without a new history entry.
      onSelectLine={(selected) => path && navigate(paths.file(repository.id, path, selected), { replace: true })}
    />
  )
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomeRoute />} />
        <Route path="repo/:repoId" element={<RepositoryRoute />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewRoute />} />
          <Route path="architecture" element={<ArchitectureRoute />} />
          <Route path="issues" element={<IssuesRoute />} />
          <Route path="files/*" element={<FileRoute />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
