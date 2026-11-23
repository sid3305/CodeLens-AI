import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Read the source files directly: Vitest strips CSS (including ?raw imports).
const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), 'utf8')

const css = `${read('./index.css')}\n${read('./App.css')}`

it('loaded the stylesheets', () => {
  expect(css.length).toBeGreaterThan(10_000)
})

function ruleBodies(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|[},\\s])${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'gm')
  return [...css.matchAll(pattern)].map((match) => match[1]).join('\n')
}

describe('stylesheet integrity (A7 / BUG-12)', () => {
  it('defines every CSS custom property it uses', () => {
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))

    const undefinedVariables = [...used].filter((name) => !defined.has(name))

    expect(undefinedVariables).toEqual([])
  })

  it('gives the primary button a visible filled style with inline icon layout', () => {
    const body = ruleBodies('.primary-button')

    expect(body).toMatch(/background(-color)?\s*:\s*var\(--accent/)
    expect(body).toMatch(/display\s*:\s*inline-flex/)
    expect(body).toMatch(/align-items\s*:\s*center/)
  })

  it('lays out secondary button icons inline with their label', () => {
    expect(ruleBodies('.secondary-button')).toMatch(/display\s*:\s*inline-flex/)
  })
})
