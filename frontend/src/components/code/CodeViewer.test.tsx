import '../../test/codemirror'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import CodeViewer, { type LineMarker } from './CodeViewer'
import { languageFor } from './codeLanguages'

const content = Array.from({ length: 12 }, (_, index) => `value_${index + 1} = ${index + 1}`).join('\n')
const markers: LineMarker[] = [
  { line: 3, severity: 'Low', title: 'Style issue' },
  { line: 3, severity: 'High', title: 'Hardcoded secret' },
  { line: 9, severity: 'Medium', title: 'Broad except' },
]

function renderViewer(overrides: Partial<Parameters<typeof CodeViewer>[0]> = {}) {
  const props = {
    path: 'app/main.py', content, line: 5, markers, onLineClick: vi.fn(), onSelectionChange: vi.fn(), ...overrides,
  }
  const result = render(<CodeViewer {...props} />)
  const view = EditorView.findFromDOM(result.container.querySelector('.cm-editor') as HTMLElement)!
  return { ...result, props, view }
}

describe('code viewer (C5)', () => {
  it('shows the file read-only, labelled for assistive technology', () => {
    const { container, view } = renderViewer()

    expect(container.querySelectorAll('.cm-line')).toHaveLength(12)
    expect(container.querySelector('.cm-line')).toHaveTextContent('value_1 = 1')
    const editable = container.querySelector('.cm-content')!
    expect(editable).toHaveAttribute('aria-label', 'Contents of app/main.py')
    expect(editable).toHaveAttribute('aria-readonly', 'true')
    expect(view.state.readOnly).toBe(true)
  })

  it('highlights the #L line', () => {
    const { container, rerender, props } = renderViewer({ line: 5 })

    const anchored = () => [...container.querySelectorAll('.cm-anchor-line')].map((line) => line.textContent)
    expect(anchored()).toEqual(['value_5 = 5'])

    rerender(<CodeViewer {...props} line={7} />)
    expect(anchored()).toEqual(['value_7 = 7'])

    rerender(<CodeViewer {...props} line={null} />)
    expect(anchored()).toEqual([])
  })

  it('marks lines with findings, most severe first', () => {
    const { container } = renderViewer()

    const dots = [...container.querySelectorAll('.cm-finding-marker')] as HTMLElement[]
    expect(dots).toHaveLength(2)
    expect(dots[0].dataset.severity).toBe('High')
    expect(dots[0].title).toBe('High: Hardcoded secret\nLow: Style issue')
    expect(dots[1].dataset.severity).toBe('Medium')
  })

  it('a click on a line number sets the anchor', () => {
    const { container, props } = renderViewer()

    const number = [...container.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find((cell) => cell.textContent === '8')!
    fireEvent.mouseDown(number)

    // jsdom has no layout, so every line sits at height 0 and the click maps
    // to line 1; the mapping to the clicked line is checked in the browser.
    expect(props.onLineClick).toHaveBeenCalledTimes(1)
    expect(vi.mocked(props.onLineClick).mock.calls[0][0]).toBeGreaterThanOrEqual(1)
  })

  it('reports the selected lines', () => {
    const { view, props } = renderViewer()
    const doc = view.state.doc

    view.dispatch({ selection: EditorSelection.range(doc.line(2).from + 2, doc.line(4).to) })
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({ start: 2, end: 4 })

    // Ending at the very start of a line does not include it.
    view.dispatch({ selection: EditorSelection.range(doc.line(6).from, doc.line(8).from) })
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({ start: 6, end: 7 })

    view.dispatch({ selection: EditorSelection.cursor(doc.line(3).from) })
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(null)
  })

  it('highlights Python and JavaScript/TypeScript, and leaves other files plain', () => {
    for (const path of ['a.py', 'b.js', 'c.jsx', 'd.ts', 'e.tsx', 'f.mjs']) expect(languageFor(path), path).not.toBeNull()
    for (const path of ['README.md', 'data.json', 'Makefile']) expect(languageFor(path), path).toBeNull()
  })
})
