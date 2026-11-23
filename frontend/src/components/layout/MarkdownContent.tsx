
import type { ReactNode } from 'react'

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }

    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }

    return <span key={index}>{part}</span>
  })
}

interface MarkdownContentProps {
  content: string
}

export default function MarkdownContent({
  content,
}: MarkdownContentProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const elements: ReactNode[] = []

  let paragraph: string[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let codeLines: string[] = []
  let insideCode = false

  const flushParagraph = () => {
    if (!paragraph.length) return

    elements.push(
      <p key={`p-${elements.length}`}>
        {renderInline(paragraph.join(' '))}
      </p>,
    )

    paragraph = []
  }

  const flushList = () => {
    if (!listItems.length || !listType) return

    const items = listItems.map((item, index) => (
      <li key={index}>{renderInline(item)}</li>
    ))

    elements.push(
      listType === 'ul'
        ? <ul key={`ul-${elements.length}`}>{items}</ul>
        : <ol key={`ol-${elements.length}`}>{items}</ol>,
    )

    listItems = []
    listType = null
  }

  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      flushParagraph()
      flushList()

      if (insideCode) {
        elements.push(
          <pre key={`code-${elements.length}`}>
            <code>{codeLines.join('\n')}</code>
          </pre>,
        )
        codeLines = []
      }

      insideCode = !insideCode
      return
    }

    if (insideCode) {
      codeLines.push(line)
      return
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)

    if (heading) {
      flushParagraph()
      flushList()

      const level = heading[1].length
      const headingContent = renderInline(heading[2])
      const key = `heading-${elements.length}`

      if (level === 1) {
        elements.push(<h2 key={key}>{headingContent}</h2>)
      } else if (level === 2) {
        elements.push(<h3 key={key}>{headingContent}</h3>)
      } else {
        elements.push(<h4 key={key}>{headingContent}</h4>)
      }

      return
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)

    if (unordered || ordered) {
      flushParagraph()

      const nextType = unordered ? 'ul' : 'ol'

      if (listType && listType !== nextType) {
        flushList()
      }

      listType = nextType
      listItems.push((unordered ?? ordered)![1])
      return
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      return
    }

    flushList()
    paragraph.push(line.trim())
  })

  flushParagraph()
  flushList()

  if (insideCode && codeLines.length) {
    elements.push(
      <pre key={`code-${elements.length}`}>
        <code>{codeLines.join('\n')}</code>
      </pre>,
    )
  }

  return <div className="prose-content">{elements}</div>
}
