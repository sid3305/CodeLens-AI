import { useEffect, useRef } from 'react'
import { EditorState, RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, lineNumbers, type DecorationSet } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

import type { Severity } from '../ui/severity'
import { languageFor } from './codeLanguages'

export interface LineMarker {
  line: number
  severity: Severity
  title: string
}

export interface LineSelection {
  start: number
  end: number
}

// Colours come from the design tokens, so both themes and the contrast
// checks apply to code too.
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.modifier], color: 'var(--cl-accent-text)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--cl-success)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--cl-warning)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--cl-fg-muted)', fontStyle: 'italic' },
  { tag: [tags.function(tags.definition(tags.variableName)), tags.definition(tags.className)], color: 'var(--cl-fg)', fontWeight: '600' },
  { tag: [tags.typeName, tags.className], color: 'var(--cl-sev-info)' },
])

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--cl-surface)', color: 'var(--cl-fg)', fontSize: '13px' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--cl-fg)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'var(--cl-surface-2)', color: 'var(--cl-fg-muted)', borderRight: '1px solid var(--cl-border)' },
  '.cm-lineNumbers .cm-gutterElement': { cursor: 'pointer', padding: '0 8px 0 12px' },
  '.cm-lineNumbers .cm-gutterElement:hover': { color: 'var(--cl-fg)', textDecoration: 'underline' },
  '.cm-anchor-line': { backgroundColor: 'var(--cl-accent-soft)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--cl-accent) 28%, transparent) !important' },
  '&.cm-focused': { outline: '2px solid var(--cl-focus)', outlineOffset: '-2px' },
  '.cm-finding-gutter .cm-gutterElement': { width: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
})

// --- The anchored line (#L<line>) -----------------------------------------------

const setAnchor = StateEffect.define<number | null>()

const anchorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setAnchor)) {
        const line = effect.value
        if (line === null || line < 1 || line > transaction.state.doc.lines) return Decoration.none
        const from = transaction.state.doc.line(line).from
        return Decoration.set([Decoration.line({ class: 'cm-anchor-line' }).range(from)])
      }
    }
    return decorations.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

// --- Finding markers -------------------------------------------------------------

const SEVERITY_COLOR: Record<Severity, string> = {
  Critical: 'var(--cl-sev-critical)',
  High: 'var(--cl-sev-high)',
  Medium: 'var(--cl-sev-medium)',
  Low: 'var(--cl-sev-low)',
  Info: 'var(--cl-sev-info)',
}

class FindingMarker extends GutterMarker {
  readonly markers: LineMarker[]

  constructor(markers: LineMarker[]) {
    super()
    this.markers = markers
  }

  eq(other: FindingMarker) {
    return other.markers === this.markers
  }

  toDOM() {
    const dot = document.createElement('span')
    const worst = this.markers[0]
    dot.className = 'cm-finding-marker'
    dot.dataset.severity = worst.severity
    // Decorative: the findings are also listed with links to their lines.
    dot.setAttribute('aria-hidden', 'true')
    dot.title = this.markers.map((marker) => `${marker.severity}: ${marker.title}`).join('\n')
    dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:9999px;background:${SEVERITY_COLOR[worst.severity]}`
    return dot
  }
}

const SEVERITY_ORDER: Severity[] = ['Critical', 'High', 'Medium', 'Low', 'Info']

function findingGutter(markers: LineMarker[]): Extension {
  return gutter({
    class: 'cm-finding-gutter',
    markers: (view) => {
      const byLine = new Map<number, LineMarker[]>()
      for (const marker of markers) {
        if (marker.line < 1 || marker.line > view.state.doc.lines) continue
        byLine.set(marker.line, [...(byLine.get(marker.line) ?? []), marker])
      }
      const ranges = [...byLine.entries()]
        .sort(([a], [b]) => a - b)
        .map(([line, items]) => {
          items.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
          return new FindingMarker(items).range(view.state.doc.line(line).from)
        })
      return RangeSet.of(ranges)
    },
  })
}

/**
 * Read-only CodeMirror 6 viewer (C5): syntax highlighting, the #L<line>
 * anchor highlighted and scrolled to, finding markers in a gutter, line
 * numbers that set the anchor, and the current selection reported.
 */
export default function CodeViewer({
  path,
  content,
  line,
  markers,
  onLineClick,
  onSelectionChange,
}: {
  path: string
  content: string
  line: number | null
  markers: LineMarker[]
  onLineClick: (line: number) => void
  onSelectionChange: (selection: LineSelection | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const callbacks = useRef({ onLineClick, onSelectionChange })
  useEffect(() => {
    callbacks.current = { onLineClick, onSelectionChange }
  })

  useEffect(() => {
    if (!host.current) return
    const language = languageFor(path)
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ 'aria-label': `Contents of ${path}`, 'aria-readonly': 'true' }),
          findingGutter(markers),
          lineNumbers({
            domEventHandlers: {
              mousedown(target, block) {
                callbacks.current.onLineClick(target.state.doc.lineAt(block.from).number)
                return true
              },
            },
          }),
          anchorField,
          ...(language ? [language] : []),
          syntaxHighlighting(highlightStyle),
          theme,
          EditorView.updateListener.of((update) => {
            if (!update.selectionSet) return
            const range = update.state.selection.main
            if (range.empty) {
              callbacks.current.onSelectionChange(null)
              return
            }
            const doc = update.state.doc
            const start = doc.lineAt(range.from).number
            // A selection ending at the start of a line does not include that line.
            const endLine = doc.lineAt(range.to)
            const end = range.to === endLine.from && endLine.number > start ? endLine.number - 1 : endLine.number
            callbacks.current.onSelectionChange({ start, end })
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // The viewer is rebuilt when the file or its findings change; the line is applied below.
  }, [path, content, markers])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const effects: StateEffect<unknown>[] = [setAnchor.of(line)]
    if (line !== null && line >= 1 && line <= editor.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(editor.state.doc.line(line).from, { y: 'center' }))
    }
    editor.dispatch({ effects })
  }, [line, path, content, markers])

  return <div ref={host} className="max-h-[70vh] overflow-hidden [&_.cm-editor]:max-h-[70vh]" data-testid="code-viewer" />
}
