import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { ThemeProvider, useTheme } from './ThemeProvider'
import { THEME_STORAGE_KEY, readPreference, writePreference } from './theme'

let systemDark = false
const listeners: Array<() => void> = []

beforeEach(() => {
  systemDark = false
  listeners.length = 0
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('dark') && systemDark },
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
    removeEventListener: vi.fn(),
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Probe() {
  const { preference, theme, setPreference } = useTheme()
  return (
    <div>
      <span>{`${preference}:${theme}`}</span>
      <button onClick={() => setPreference('dark')}>dark</button>
      <button onClick={() => setPreference('system')}>system</button>
    </div>
  )
}

describe('theme (C1)', () => {
  it('follows the system preference by default', () => {
    systemDark = true
    render(<ThemeProvider><Probe /></ThemeProvider>)

    expect(screen.getByText('system:dark')).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('reacts when the system preference changes', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    systemDark = true

    act(() => listeners.forEach((listener) => listener()))

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('persists an explicit choice and restores it', () => {
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByText('dark').click())
    unmount()

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByText('dark:dark')).toBeInTheDocument()
  })

  it('going back to "system" forgets the stored choice', () => {
    writePreference('dark')
    render(<ThemeProvider><Probe /></ThemeProvider>)

    act(() => screen.getByText('system').click())

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })

    expect(readPreference()).toBe('system')
    expect(() => writePreference('dark')).not.toThrow()
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByText('dark').click())
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('index.html applies the stored theme before first paint', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html'), 'utf8')

    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toContain(THEME_STORAGE_KEY)
    expect(head).toContain('dataset.theme')
    // The theme script must run before the app bundle loads.
    expect(html.indexOf('dataset.theme')).toBeLessThan(html.indexOf('type="module"'))
  })
})
