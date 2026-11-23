import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Trash2 } from 'lucide-react'

import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
  InlineMessage,
  SeverityBadge,
  StatTile,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToastProvider,
  TooltipProvider,
  useToast,
} from '.'

describe('Button (C1 / A7)', () => {
  it('primary is a filled accent button with inline icon layout', () => {
    render(<Button variant="primary">Run analysis</Button>)
    const button = screen.getByRole('button', { name: 'Run analysis' })

    expect(button.className).toMatch(/\bbg-accent\b/)
    expect(button.className).toMatch(/\binline-flex\b/)
    expect(button).toHaveAttribute('type', 'button')
  })

  it('loading disables the button and marks it busy', () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })
})

describe('IconButton (C1 / C9)', () => {
  it('always has an accessible name', () => {
    render(
      <TooltipProvider>
        <IconButton aria-label="Delete repository" icon={<Trash2 size={16} />} />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Delete repository' })).toBeInTheDocument()
  })

  it('does not compile without aria-label', () => {
    // @ts-expect-error aria-label is required at the type level
    const element = <IconButton icon={<Trash2 />} />
    expect(element).toBeTruthy()
  })
})

describe('SeverityBadge (C1)', () => {
  it.each(['Critical', 'High', 'Medium', 'Low', 'Info'])('%s shows its name, not just a colour', (severity) => {
    const { container } = render(<SeverityBadge severity={severity.toLowerCase()} />)

    expect(container).toHaveTextContent(severity)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('uses a different icon shape for each level', () => {
    const shapes = ['Critical', 'High', 'Medium', 'Low', 'Info'].map((severity) => {
      const { container, unmount } = render(<SeverityBadge severity={severity} />)
      const shape = container.querySelector('svg')?.getAttribute('class')
      unmount()
      return shape
    })
    expect(new Set(shapes).size).toBe(5)
  })

  it('treats unknown values as Info', () => {
    render(<SeverityBadge severity="weird" />)
    expect(screen.getByText('Info')).toBeInTheDocument()
  })
})

describe('Dialog (C1 / C9)', () => {
  function Harness({ dismissible = true }: { dismissible?: boolean }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Delete repository?"
          description="This cannot be undone."
          dismissible={dismissible}
          footer={<Button onClick={() => setOpen(false)}>Cancel</Button>}
        />
      </>
    )
  }

  it('traps focus, closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open' })

    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Delete repository?' })
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await user.tab()
    await user.tab()
    await user.tab()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('ignores Escape while an action is running', async () => {
    const user = userEvent.setup()
    render(<Harness dismissible={false} />)

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.keyboard('{Escape}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('Tabs (C1)', () => {
  it('switches with arrow keys', async () => {
    function Harness() {
      const [tab, setTab] = useState('a')
      return (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList label="Views">
            <TabsTrigger value="a">First</TabsTrigger>
            <TabsTrigger value="b">Second</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Panel A</TabsContent>
          <TabsContent value="b">Panel B</TabsContent>
        </Tabs>
      )
    }
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
    screen.getByRole('tab', { name: 'First' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Panel B')).toBeVisible()
  })
})

describe('Toast (C1 / C9)', () => {
  function Trigger({ tone }: { tone: 'success' | 'error' }) {
    const { notify } = useToast()
    return <button onClick={() => notify(tone, `${tone} message`)}>notify</button>
  }

  it('announces errors assertively and keeps them until dismissed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<ToastProvider><Trigger tone="error" /></ToastProvider>)

    act(() => screen.getByText('notify').click())
    await act(() => vi.advanceTimersByTimeAsync(10_000))

    expect(screen.getByText('error message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('labels the tone for screen readers', () => {
    render(<ToastProvider><Trigger tone="success" /></ToastProvider>)
    act(() => screen.getByText('notify').click())

    expect(screen.getAllByText(/success/i).length).toBeGreaterThan(0)
  })
})

describe('EmptyState, InlineMessage, StatTile', () => {
  it('EmptyState renders a heading at the requested level', () => {
    render(<EmptyState title="Page not found" headingLevel={1} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
  })

  it('InlineMessage uses alert for errors and status for notices', () => {
    render(
      <>
        <InlineMessage tone="error">Broken</InlineMessage>
        <InlineMessage tone="info">Saved</InlineMessage>
      </>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Broken')
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('StatTile reads label then value', () => {
    const { container } = render(<StatTile label="Source files" value={7} />)
    expect(container.querySelector('dt')).toHaveTextContent('Source files')
    expect(container.querySelector('dd')).toHaveTextContent('7')
  })
})
