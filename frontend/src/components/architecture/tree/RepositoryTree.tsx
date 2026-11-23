import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, File, Folder, FolderOpen, Repeat } from 'lucide-react'

import { SeverityBadge, cn } from '../../ui'
import type { TreeNode, VisibleRow } from './model'

export const ROW_HEIGHT = 32
const OVERSCAN = 8
/** Used before the viewport is measured (and in jsdom, which has no layout). */
const FALLBACK_VIEWPORT = 560
const TYPEAHEAD_RESET_MS = 600

interface RepositoryTreeProps {
  label: string
  rows: VisibleRow[]
  expanded: Set<string>
  /** The file shown in the side panel. */
  selectedPath: string | null
  onToggle: (path: string, open: boolean) => void
  onSelectFile: (path: string) => void
  /** A new object each time something outside asks to reveal a node (jump to importer). */
  reveal?: { path: string } | null
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function RowContent({ node, expanded }: { node: TreeNode; expanded: boolean }) {
  const stats = node.stats
  const isFolder = node.kind === 'folder'

  return (
    <>
      {isFolder ? (
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cn('shrink-0 text-fg-subtle transition-transform duration-[var(--cl-duration-fast)]', expanded && 'rotate-90')}
        />
      ) : (
        <span className="w-[14px] shrink-0" aria-hidden="true" />
      )}
      {isFolder ? (
        expanded ? (
          <FolderOpen size={15} aria-hidden="true" className="shrink-0 text-fg-muted" />
        ) : (
          <Folder size={15} aria-hidden="true" className="shrink-0 text-fg-muted" />
        )
      ) : (
        <File size={15} aria-hidden="true" className="shrink-0 text-fg-subtle" />
      )}
      <span className="min-w-0 truncate font-mono text-sm">{node.name}</span>

      {stats && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-xs text-fg-muted">
          {stats.inCycle && (
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-warning-soft px-1 font-medium text-warning">
              <Repeat size={11} aria-hidden="true" />
              cycle
            </span>
          )}
          {stats.issues > 0 && stats.worst && (
            <SeverityBadge
              severity={stats.worst}
              label={plural(stats.issues, 'issue')}
              title={`Most severe: ${stats.worst}`}
            />
          )}
          <span className="inline-flex w-10 items-center justify-end gap-0.5 tabular-nums" title={`Imports ${plural(stats.imports.length, 'file')}`}>
            <ArrowUpRight size={11} aria-hidden="true" />
            {stats.imports.length}
          </span>
          <span className="inline-flex w-10 items-center justify-end gap-0.5 tabular-nums" title={`Imported by ${plural(stats.importers.length, 'file')}`}>
            <ArrowDownLeft size={11} aria-hidden="true" />
            {stats.importers.length}
          </span>
        </span>
      )}
    </>
  )
}

/** The accessible name of a row: everything a sighted user reads in it. */
function rowLabel(node: TreeNode): string {
  const stats = node.stats
  if (node.kind === 'folder' || !stats) return node.name
  const parts = [
    node.name,
    `imports ${plural(stats.imports.length, 'file')}`,
    `imported by ${plural(stats.importers.length, 'file')}`,
  ]
  if (stats.inCycle) parts.push('in an import cycle')
  if (stats.issues > 0) parts.push(`${plural(stats.issues, 'issue')}, most severe ${stats.worst}`)
  return parts.join(', ')
}

/**
 * A WAI-ARIA tree (role=tree/treeitem) over a flat list of visible rows.
 * Only the rows in view are rendered, so thousands of files stay fast.
 * Focus stays on the tree; aria-activedescendant names the active row.
 */
export default function RepositoryTree({
  label,
  rows,
  expanded,
  selectedPath,
  onToggle,
  onSelectFile,
  reveal = null,
}: RepositoryTreeProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT)
  const [activePath, setActivePath] = useState<string | null>(selectedPath)
  const typeahead = useRef({ text: '', at: 0 })

  // An outside request to reveal a node makes it active (adjusted during render).
  const [seenReveal, setSeenReveal] = useState(reveal)
  if (reveal !== seenReveal) {
    setSeenReveal(reveal)
    if (reveal) setActivePath(reveal.path)
  }

  const indexByPath = useMemo(() => new Map(rows.map((row, index) => [row.node.path, index])), [rows])
  // The active row may have been filtered or collapsed away: fall back.
  const activeIndex =
    (activePath !== null ? indexByPath.get(activePath) : undefined) ??
    (selectedPath !== null ? indexByPath.get(selectedPath) : undefined) ??
    (rows.length ? 0 : -1)
  const active = activeIndex >= 0 ? rows[activeIndex] : null

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setViewport(element.clientHeight || FALLBACK_VIEWPORT))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Keep the active row in view (keyboard moves, reveals).
  useEffect(() => {
    const element = viewportRef.current
    if (!element || activeIndex < 0) return
    const top = activeIndex * ROW_HEIGHT
    const height = element.clientHeight || viewport
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + ROW_HEIGHT > element.scrollTop + height) element.scrollTop = top + ROW_HEIGHT - height
    setScrollTop(element.scrollTop)
  }, [activeIndex, viewport])


  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const rendered: number[] = []
  for (let index = first; index < last; index++) rendered.push(index)
  // aria-activedescendant must always point at a rendered element.
  if (activeIndex >= 0 && (activeIndex < first || activeIndex >= last)) rendered.push(activeIndex)

  const moveTo = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))]
    if (row) setActivePath(row.node.path)
  }

  const activate = (row: VisibleRow) => {
    setActivePath(row.node.path)
    if (row.node.kind === 'folder') onToggle(row.node.path, !expanded.has(row.node.path))
    else onSelectFile(row.node.path)
  }

  const findByTypeahead = (character: string) => {
    const now = Date.now()
    const state = typeahead.current
    state.text = now - state.at > TYPEAHEAD_RESET_MS ? character : state.text + character
    state.at = now
    const needle = state.text.toLowerCase()
    // Search forward from the next row (the current one for a longer prefix), wrapping.
    const start = state.text.length > 1 ? activeIndex : activeIndex + 1
    for (let offset = 0; offset < rows.length; offset++) {
      const index = (start + offset) % rows.length
      if (rows[index].node.name.toLowerCase().startsWith(needle)) return index
    }
    return -1
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!active) return
    const node = active.node
    const isOpenFolder = node.kind === 'folder' && expanded.has(node.path)
    const page = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1)
    let handled = true
    const isCharacter = event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey
    // Any other key ends a type-ahead sequence.
    if (!isCharacter) typeahead.current.text = ''

    switch (event.key) {
      case 'ArrowDown':
        moveTo(activeIndex + 1)
        break
      case 'ArrowUp':
        moveTo(activeIndex - 1)
        break
      case 'Home':
        moveTo(0)
        break
      case 'End':
        moveTo(rows.length - 1)
        break
      case 'PageDown':
        moveTo(activeIndex + page)
        break
      case 'PageUp':
        moveTo(activeIndex - page)
        break
      case 'ArrowRight':
        if (node.kind === 'folder') {
          if (!isOpenFolder) onToggle(node.path, true)
          else if (rows[activeIndex + 1]?.node.parent === node) moveTo(activeIndex + 1)
        }
        break
      case 'ArrowLeft':
        if (isOpenFolder) onToggle(node.path, false)
        else if (node.parent) setActivePath(node.parent.path)
        break
      case 'Enter':
      case ' ':
        activate(active)
        break
      default:
        handled = false
        if (isCharacter) {
          const index = findByTypeahead(event.key)
          if (index >= 0) moveTo(index)
          handled = true
        }
    }

    if (handled) event.preventDefault()
  }

  if (rows.length === 0) return null

  return (
    <div
      ref={viewportRef}
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={active ? `tree-${active.node.id}` : undefined}
      onKeyDown={onKeyDown}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="relative h-[min(70vh,560px)] min-h-60 overflow-y-auto rounded-sm border border-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
        {rendered.map((index) => {
          const row = rows[index]
          const { node } = row
          const isFolder = node.kind === 'folder'
          const isOpen = isFolder && expanded.has(node.path)
          const isActive = index === activeIndex
          const isSelected = !isFolder && node.path === selectedPath
          return (
            <div
              key={node.id}
              id={`tree-${node.id}`}
              role="treeitem"
              aria-level={node.depth + 1}
              aria-posinset={row.position}
              aria-setsize={row.setSize}
              aria-expanded={isFolder ? isOpen : undefined}
              aria-selected={isFolder ? undefined : isSelected}
              aria-label={rowLabel(node)}
              title={node.path}
              onClick={() => {
                viewportRef.current?.focus({ preventScroll: true })
                activate(row)
              }}
              style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, paddingLeft: 8 + node.depth * 16 }}
              className={cn(
                'absolute inset-x-0 flex cursor-pointer items-center gap-1.5 pr-2 text-fg hover:bg-surface-hover',
                isSelected && 'bg-accent-soft text-accent-text hover:bg-accent-soft',
                isActive && 'outline-2 -outline-offset-2 outline-transparent [[role=tree]:focus-visible_&]:outline-accent',
              )}
            >
              <RowContent node={node} expanded={isOpen} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
