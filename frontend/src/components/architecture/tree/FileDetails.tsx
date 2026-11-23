import { useContext, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, FileCode2, Repeat, X } from 'lucide-react'

import { Badge, Button, IconButton, SeverityBadge } from '../../ui'
import { ModuleName } from '../DependencyViews'
import { OpenFileContext } from '../openFile'
import type { TreeNode } from './model'

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {title} <span className="font-normal tabular-nums">({count})</span>
      </h4>
      {count === 0 ? <p className="text-sm text-fg-subtle">None</p> : children}
    </section>
  )
}

/** What one file imports and what imports it. */
export default function FileDetails({
  node,
  onJump,
  onClose,
}: {
  node: TreeNode | null
  /** Select a file in the tree. */
  onJump: (path: string) => void
  onClose: () => void
}) {
  const openFile = useContext(OpenFileContext)

  if (!node || node.kind !== 'file') {
    return (
      <aside aria-label="File details" className="rounded-sm border border-dashed border-border p-4 text-sm text-fg-muted">
        Select a file to see what it imports and which files import it.
      </aside>
    )
  }

  const stats = node.stats

  return (
    <aside aria-labelledby="file-details-heading" className="space-y-4 rounded-sm border border-border bg-surface p-4 lg:sticky lg:top-16 lg:self-start">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="file-details-heading" className="font-mono text-md font-semibold break-all">{node.name}</h3>
          <p className="font-mono text-xs break-all text-fg-subtle">{node.path}</p>
        </div>
        <IconButton size="sm" aria-label="Close file details" icon={<X size={14} />} onClick={onClose} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {openFile && (
          <Button size="sm" icon={<FileCode2 size={14} aria-hidden="true" />} onClick={() => openFile(node.path)}>
            Open in file preview
          </Button>
        )}
        {stats?.inCycle && <Badge tone="warning" icon={<Repeat size={11} aria-hidden="true" />}>In an import cycle</Badge>}
        {stats && stats.issues > 0 && stats.worst && (
          <SeverityBadge severity={stats.worst} label={`${stats.issues} issue${stats.issues === 1 ? '' : 's'}`} title={`Most severe: ${stats.worst}`} />
        )}
      </div>

      {!stats ? (
        <p className="text-sm text-fg-muted">
          This file was not part of the import analysis (only Python and JavaScript/TypeScript sources are).
        </p>
      ) : (
        <>
          <Section title="Imports" count={stats.imports.length + stats.external.length + stats.stdlib.length + stats.unresolved.length}>
            <ul className="space-y-1 text-sm">
              {stats.imports.map((path) => (
                <li key={path} className="flex items-center gap-1.5">
                  <ArrowUpRight size={12} aria-hidden="true" className="shrink-0 text-fg-subtle" />
                  <ModuleName path={path} label={path} />
                </li>
              ))}
              {stats.external.map((name) => (
                <li key={`ext:${name}`} className="flex items-center gap-1.5">
                  <Badge tone="accent">package</Badge>
                  <span className="font-mono break-all">{name}</span>
                </li>
              ))}
              {stats.stdlib.map((name) => (
                <li key={`std:${name}`} className="flex items-center gap-1.5">
                  <Badge>stdlib</Badge>
                  <span className="font-mono break-all">{name}</span>
                </li>
              ))}
              {stats.unresolved.map((item) => (
                <li key={`unres:${item.line}:${item.specifier}`} className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="warning">unresolved</Badge>
                  <span className="font-mono break-all">{item.specifier}</span>
                  <span className="text-xs text-fg-subtle">line {item.line} · {item.reason}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Imported by" count={stats.importers.length}>
            <ul className="space-y-1 text-sm">
              {stats.importers.map((path) => (
                <li key={path} className="flex items-center gap-1.5">
                  <ArrowDownLeft size={12} aria-hidden="true" className="shrink-0 text-fg-subtle" />
                  <button
                    type="button"
                    onClick={() => onJump(path)}
                    aria-label={`Show ${path} in the tree`}
                    title={path}
                    className="rounded-sm text-left font-mono break-all text-accent-text underline-offset-2 hover:underline"
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </aside>
  )
}
