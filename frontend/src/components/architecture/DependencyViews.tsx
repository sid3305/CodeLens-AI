import { useContext, useId, useState } from 'react'
import { GitMerge, Network, Package, Search } from 'lucide-react'

import type {
  CircularDependency,
  DependenciesAnalysisResponse,
  ExternalDependency,
  ModuleDependency,
} from '../../types'
import { Badge, Button, EmptyState, SeverityBadge } from '../ui'
import { OpenFileContext } from './openFile'

/** Last path segment, for either separator style. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * A repository file shown by name (full path on hover and for screen
 * readers). Opens the file preview when the page provides a handler.
 */
export function ModuleName({ path }: { path: string }) {
  const openFile = useContext(OpenFileContext)

  if (!openFile) {
    return (
      <span className="font-mono text-sm text-fg" title={path}>
        {baseName(path)}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => openFile(path)}
      title={path}
      aria-label={`Open ${path}`}
      className="rounded-sm font-mono text-sm text-accent-text underline-offset-2 hover:underline"
    >
      {baseName(path)}
    </button>
  )
}

const severityLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export function CycleCard({ cycle }: { cycle: CircularDependency }) {
  return (
    <article className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={severityLabel(cycle.severity)} />
        <Badge>{cycle.cycle.length === 1 ? 'Self-import' : `${cycle.cycle.length} files`}</Badge>
      </div>
      <p className="mt-2 text-sm break-words text-fg-muted">{cycle.description}</p>
      <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Import order">
        {[...cycle.cycle, cycle.cycle[0]].map((path, index) => (
          <li key={`${path}-${index}`} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true" className="text-fg-subtle">→</span>}
            <ModuleName path={path} />
          </li>
        ))}
      </ol>
    </article>
  )
}

function PackageRow({ dep }: { dep: ExternalDependency }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 first:border-t-0">
      <Package size={15} aria-hidden="true" className="shrink-0 text-fg-muted" />
      <span className="min-w-0 font-mono text-sm font-medium break-all">{dep.name}</span>
      {dep.version && <Badge>{dep.version}</Badge>}
      {dep.is_dev_dependency && <Badge tone="warning">dev</Badge>}
      {dep.declared === false && <Badge tone="neutral">not in a manifest</Badge>}
      <span className="ml-auto text-sm text-fg-muted tabular-nums">
        {dep.import_count} import{dep.import_count === 1 ? '' : 's'} · {dep.language}
      </span>
    </li>
  )
}

function ModuleRows({ dependencies }: { dependencies: ModuleDependency[] }) {
  return (
    <ul className="rounded-md border border-border bg-surface">
      {dependencies.map((dep) => (
        <li
          key={`${dep.source_module}->${dep.target_module}`}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-4 py-2 first:border-t-0"
        >
          <ModuleName path={dep.source_module} />
          <span aria-label="imports" className="text-fg-subtle">→</span>
          <ModuleName path={dep.target_module} />
          {dep.imports.length > 0 && (
            <span className="min-w-0 truncate font-mono text-xs text-fg-subtle">
              {dep.imports.slice(0, 3).join(', ')}
              {dep.imports.length > 3 && ` +${dep.imports.length - 3}`}
            </span>
          )}
          <span className="ml-auto text-xs text-fg-muted tabular-nums">×{dep.edge_count}</span>
        </li>
      ))}
    </ul>
  )
}

function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">{label}</label>
      <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        className="h-9 w-full rounded-sm border border-border-strong bg-surface pl-8 pr-2 text-base text-fg placeholder:text-fg-subtle"
      />
    </div>
  )
}

export function ExternalTab({ external }: { external: ExternalDependency[] }) {
  const [filter, setFilter] = useState<'all' | 'prod' | 'dev'>('all')
  const [query, setQuery] = useState('')
  const filterId = useId()

  const visible = [...external]
    .filter((dep) => (filter === 'prod' ? !dep.is_dev_dependency : filter === 'dev' ? dep.is_dev_dependency : true))
    .filter((dep) => dep.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.import_count - a.import_count)

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <SearchField label="Search packages" value={query} onChange={setQuery} />
        <div>
          <label htmlFor={filterId} className="sr-only">Dependency type</label>
          <select
            id={filterId}
            value={filter}
            onChange={(event) => setFilter(event.target.value as 'all' | 'prod' | 'dev')}
            className="h-9 w-full rounded-sm border border-border-strong bg-surface px-2.5 text-base text-fg"
          >
            <option value="all">All packages</option>
            <option value="prod">Production</option>
            <option value="dev">Development</option>
          </select>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="py-4 text-center text-base text-fg-muted">No packages match your filters.</p>
      ) : (
        <ul className="rounded-md border border-border bg-surface">
          {visible.map((dep) => <PackageRow key={dep.name} dep={dep} />)}
        </ul>
      )}
    </div>
  )
}

export function ModulesTab({ modules }: { modules: ModuleDependency[] }) {
  const [query, setQuery] = useState('')
  const needle = query.toLowerCase()
  const visible = [...modules]
    .filter((dep) =>
      [dep.source_module, dep.target_module, ...dep.imports].some((text) => text.toLowerCase().includes(needle)),
    )
    .sort((a, b) => b.edge_count - a.edge_count)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1"><SearchField label="Search modules or imports" value={query} onChange={setQuery} /></div>
        <p className="text-sm text-fg-muted" role="status">{visible.length} of {modules.length} dependencies</p>
      </div>
      {visible.length === 0
        ? <p className="py-4 text-center text-base text-fg-muted">No module dependencies match your search.</p>
        : <ModuleRows dependencies={visible} />}
    </div>
  )
}

export function OverviewTab({ analysis, onShowCircular }: { analysis: DependenciesAnalysisResponse; onShowCircular: () => void }) {
  const topCycles = analysis.circular_dependencies.slice(0, 3)
  const topPackages = [...analysis.external_dependencies].sort((a, b) => b.import_count - a.import_count).slice(0, 5)
  const topModules = [...analysis.module_dependencies].sort((a, b) => b.edge_count - a.edge_count).slice(0, 10)

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-labelledby="overview-cycles" className="space-y-2">
        <h3 id="overview-cycles" className="flex items-center gap-2 font-semibold">
          <GitMerge size={15} aria-hidden="true" /> Circular dependencies
          <Badge>{analysis.circular_dependencies.length}</Badge>
        </h3>
        {topCycles.length === 0 ? (
          <p className="text-base text-fg-muted">No circular imports.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {topCycles.map((cycle, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2 rounded-sm bg-surface-2 px-3 py-2">
                  <SeverityBadge severity={severityLabel(cycle.severity)} />
                  {cycle.cycle.map((path, i) => (
                    <span key={`${path}-${i}`} className="flex items-center gap-2">
                      {i > 0 && <span aria-hidden="true" className="text-fg-subtle">→</span>}
                      <ModuleName path={path} />
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {analysis.circular_dependencies.length > 3 && (
              <Button size="sm" variant="ghost" onClick={onShowCircular}>
                View all {analysis.circular_dependencies.length} circular dependencies
              </Button>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="overview-packages" className="space-y-2">
        <h3 id="overview-packages" className="flex items-center gap-2 font-semibold">
          <Package size={15} aria-hidden="true" /> Top external packages
          <Badge>{analysis.external_dependencies.length}</Badge>
        </h3>
        {topPackages.length === 0
          ? <p className="text-base text-fg-muted">No external packages.</p>
          : <ul className="rounded-md border border-border bg-surface">{topPackages.map((dep) => <PackageRow key={dep.name} dep={dep} />)}</ul>}
      </section>

      <section aria-labelledby="overview-modules" className="space-y-2 lg:col-span-2">
        <h3 id="overview-modules" className="flex items-center gap-2 font-semibold">
          <Network size={15} aria-hidden="true" /> Most connected modules
          <Badge>{analysis.module_dependencies.length}</Badge>
        </h3>
        {topModules.length === 0
          ? <p className="text-base text-fg-muted">No internal module dependencies.</p>
          : <ModuleRows dependencies={topModules} />}
      </section>
    </div>
  )
}

export function CyclesTab({ cycles }: { cycles: CircularDependency[] }) {
  if (cycles.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        title="No circular imports"
        description="No file imports itself through a chain of other files."
      />
    )
  }
  return (
    <ul className="space-y-3">
      {cycles.map((cycle, index) => (
        <li key={index}><CycleCard cycle={cycle} /></li>
      ))}
    </ul>
  )
}
