import { ChevronDown, FileWarning, Files, GitMerge, Package, RefreshCw, Zap } from 'lucide-react'

import { useMemo } from 'react'

import { useAnalysis, useDependencies, useRefreshDependencies, useRepositoryFiles } from '../data/hooks'
import { errorMessage } from '../services/api'
import type { DependenciesAnalysisResponse, Repository } from '../types'
import {
  CyclesTab,
  ExternalTab,
  ModuleName,
  ModulesTab,
  OverviewTab,
} from '../components/architecture/DependencyViews'
import { OpenFileContext } from '../components/architecture/openFile'
import TreeView from '../components/architecture/tree/TreeView'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  IconButton,
  InlineMessage,
  LoadingBlock,
  StatTile,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui'
import { PageContainer, PageHeader } from './PageHeader'
import type { ArchitectureView } from './architectureViews'


/** Imports that could not be resolved and files that could not be parsed. */
function ProblemsSection({ analysis }: { analysis: DependenciesAnalysisResponse }) {
  const unresolved = analysis.unresolved_imports ?? []
  const skipped = analysis.skipped_files ?? []
  const total = unresolved.length + skipped.length

  return (
    <details className="group rounded-md border border-border bg-surface" open={total > 0 && total <= 5}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
        <span className="flex items-center gap-2 font-semibold">
          <FileWarning size={16} aria-hidden="true" />
          Unresolved imports and skipped files
          <Badge tone={total ? 'warning' : 'neutral'}>{total}</Badge>
        </span>
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-3">
        <p className="text-sm text-fg-muted">
          Unresolved imports look local but could not be matched to a file; they are not counted as
          packages. Skipped files could not be parsed, so their imports are missing above.
        </p>

        <section aria-labelledby="unresolved-heading">
          <h3 id="unresolved-heading" className="text-sm font-semibold">Unresolved imports ({unresolved.length})</h3>
          {unresolved.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">Every import was resolved.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-sm border border-border">
              {unresolved.map((item) => (
                <li key={`${item.file}:${item.line}:${item.specifier}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-sm">
                  <code className="font-mono font-medium break-all">{item.specifier}</code>
                  <span className="text-fg-muted">in</span>
                  <ModuleName path={item.file} />
                  <span className="text-fg-subtle">line {item.line}</span>
                  <span className="w-full text-fg-muted">{item.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="skipped-heading">
          <h3 id="skipped-heading" className="text-sm font-semibold">Skipped files ({skipped.length})</h3>
          {skipped.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">Every source file was parsed.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-sm border border-border">
              {skipped.map((item) => (
                <li key={item.path} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm">
                  <ModuleName path={item.path} />
                  <span className="text-fg-muted">{item.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  )
}

/** Render with key={repository.id}. */
export default function ArchitecturePage({
  repository,
  view,
  onViewChange,
  selectedFile,
  onSelectFile,
  onOpenFile,
}: {
  repository: Repository
  /** The open view; kept in the URL by the route. */
  view: ArchitectureView
  onViewChange: (view: ArchitectureView) => void
  /** The file shown in the tree's side panel; kept in the URL by the route. */
  selectedFile: string | null
  onSelectFile: (path: string | null) => void
  onOpenFile: (path: string) => void
}) {
  const files = useRepositoryFiles(repository.id)
  const findings = useAnalysis(repository.id).data?.findings
  const filePaths = useMemo(() => files.data?.map((file) => file.path), [files.data])
  const noFindings = useMemo(() => [], [])
  const dependencies = useDependencies(repository.id)
  const refresh = useRefreshDependencies(repository.id)

  const analysis = dependencies.data
  const error = refresh.error ?? dependencies.error

  return (
    <OpenFileContext.Provider value={onOpenFile}>
      <PageContainer>
        <PageHeader
          title="Architecture"
          description="How files depend on each other and on external packages."
          actions={
            <IconButton
              aria-label="Refresh dependency analysis"
              icon={<RefreshCw size={16} className={refresh.isPending || dependencies.isFetching ? 'animate-spin' : undefined} />}
              disabled={refresh.isPending || dependencies.isFetching}
              onClick={() => refresh.mutate()}
            />
          }
        />

        {error && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <InlineMessage tone="error">{errorMessage(error, 'Failed to load dependencies')}</InlineMessage>
            <Button size="sm" onClick={() => refresh.mutate()}>Retry</Button>
          </div>
        )}

        {!analysis ? (
          dependencies.isPending && <LoadingBlock label="Analyzing dependencies" lines={4} />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
              <StatTile icon={<Files size={18} />} label="Source files" value={analysis.total_internal_modules} />
              <StatTile icon={<Package size={18} />} label="External packages" value={analysis.total_external_dependencies} />
              <StatTile icon={<GitMerge size={18} />} label="Import cycles" value={analysis.stats.circular_import_count} />
              <StatTile icon={<Zap size={18} />} label="Import statements" value={analysis.stats.total_imports} />
            </div>

            <Card aria-labelledby="dependency-views-heading">
              <CardHeader
                titleId="dependency-views-heading"
                title="Dependencies"
                description="Imports between files, circular dependencies and external packages"
              />
              <CardBody>
                <Tabs value={view} onValueChange={(value) => onViewChange(value as ArchitectureView)}>
                  <TabsList label="Dependency views">
                    <TabsTrigger value="tree">Tree</TabsTrigger>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="circular">Circular ({analysis.circular_dependencies.length})</TabsTrigger>
                    <TabsTrigger value="external">External ({analysis.external_dependencies.length})</TabsTrigger>
                    <TabsTrigger value="modules">Modules ({analysis.module_dependencies.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="tree">
                    {filePaths ? (
                      <TreeView
                        filePaths={filePaths}
                        analysis={analysis}
                        findings={findings ?? noFindings}
                        selectedPath={selectedFile}
                        onSelectFile={onSelectFile}
                      />
                    ) : files.error ? (
                      <InlineMessage tone="error">{errorMessage(files.error, 'Unable to list the repository files.')}</InlineMessage>
                    ) : (
                      <LoadingBlock label="Loading files" lines={6} />
                    )}
                  </TabsContent>
                  <TabsContent value="overview">
                    <OverviewTab analysis={analysis} onShowCircular={() => onViewChange('circular')} />
                  </TabsContent>
                  <TabsContent value="circular">
                    <CyclesTab cycles={analysis.circular_dependencies} />
                  </TabsContent>
                  <TabsContent value="external">
                    <ExternalTab external={analysis.external_dependencies} />
                  </TabsContent>
                  <TabsContent value="modules">
                    <ModulesTab modules={analysis.module_dependencies} />
                  </TabsContent>
                </Tabs>
              </CardBody>
            </Card>

            <ProblemsSection analysis={analysis} />
          </div>
        )}
      </PageContainer>
    </OpenFileContext.Provider>
  )
}
