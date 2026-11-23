import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Vitest strips CSS, so read the source files directly.
const here = dirname(fileURLToPath(import.meta.url))
const css = ['index.css', join('styles', 'tokens.css')]
  .map((file) => readFileSync(join(here, file), 'utf8'))
  .join('\n')

it('loaded the stylesheets', () => {
  expect(css).toContain('@theme inline')
})

describe('stylesheet integrity (A7, carried into the design system)', () => {
  it('defines every CSS custom property it uses', () => {
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))

    expect([...used].filter((name) => !defined.has(name))).toEqual([])
  })

  it('maps every colour token into Tailwind', () => {
    const tokens = new Set([...css.matchAll(/--cl-([\w-]+):\s*#/g)].map((m) => m[1]))
    const themed = new Set([...css.matchAll(/--color-[\w-]+:\s*var\(--cl-([\w-]+)\)/g)].map((m) => m[1]))

    expect([...tokens].filter((name) => !themed.has(name))).toEqual([])
  })

  it('keeps a visible keyboard focus style', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--cl-focus\)/)
  })

  it('respects reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  it('has no legacy stylesheet left', () => {
    expect(() => readFileSync(join(here, 'App.css'), 'utf8')).toThrow()
  })
})
