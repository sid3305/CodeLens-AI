import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import MarkdownContent from './MarkdownContent'

describe('MarkdownContent', () => {
  it('renders headings, emphasis and inline code', () => {
    render(<MarkdownContent content={'## Title\n\n**bold** and `code`'} />)

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('renders model-supplied HTML as inert text', () => {
    const { container } = render(
      <MarkdownContent content={'<img src=x onerror=alert(1)>'} />,
    )

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
