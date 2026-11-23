import { useEffect, useRef } from 'react'

/**
 * Source with line numbers. `firstLine` offsets the numbering for excerpts;
 * the highlighted line is scrolled into view once rendered.
 */
export default function CodeLines({
  content,
  highlightLine = null,
  firstLine = 1,
  label,
  className,
}: {
  content: string
  highlightLine?: number | null
  firstLine?: number
  /** Accessible name for the scrollable code region. */
  label: string
  className?: string
}) {
  const highlighted = useRef<HTMLDivElement>(null)

  useEffect(() => {
    highlighted.current?.scrollIntoView?.({ block: 'center' })
  }, [highlightLine, content])

  const lines = content.split('\n')

  return (
    // Scrollable regions must be keyboard reachable (tabIndex) and named.
    <pre className={`code-lines ${className ?? ''}`} tabIndex={0} aria-label={label}>
      {lines.map((line, index) => {
        const number = firstLine + index
        const isHighlighted = number === highlightLine
        return (
          <div
            key={number}
            id={`L${number}`}
            ref={isHighlighted ? highlighted : undefined}
            className="code-line"
            data-highlighted={isHighlighted || undefined}
          >
            <span aria-hidden="true">{number}</span>
            <code>{line || ' '}</code>
          </div>
        )
      })}
    </pre>
  )
}
