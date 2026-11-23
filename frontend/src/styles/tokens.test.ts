import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Vitest strips CSS imports, so read the source directly. (A literal
// new URL('./x.css', import.meta.url) is rewritten by Vite into an asset URL.)
const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'tokens.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
  return Object.fromEntries(
    [...body.matchAll(/--cl-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
  )
}

const light = block(':root')
const dark = { ...light, ...block(":root[data-theme='dark']") }

function luminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Text (4.5:1): every foreground used for text on every background it sits on.
const TEXT_PAIRS: [string, string][] = [
  ['fg', 'bg'], ['fg', 'surface'], ['fg', 'surface-2'], ['fg', 'surface-hover'], ['fg', 'code-bg'],
  ['fg-muted', 'bg'], ['fg-muted', 'surface'], ['fg-muted', 'surface-2'], ['fg-muted', 'surface-hover'],
  ['fg-subtle', 'bg'], ['fg-subtle', 'surface'], ['fg-subtle', 'surface-2'], ['fg-subtle', 'code-bg'],
  ['fg', 'code-highlight'], ['fg-subtle', 'code-highlight'],
  ['accent-text', 'surface'], ['accent-text', 'bg'], ['accent-text', 'accent-soft'], ['accent-text', 'surface-2'],
  ['on-accent', 'accent'], ['on-accent', 'accent-hover'],
  ['danger', 'surface'], ['danger', 'danger-soft'], ['danger', 'bg'],
  ['success', 'surface'], ['success', 'success-soft'],
  ['warning', 'surface'], ['warning', 'warning-soft'],
  ...(['critical', 'high', 'medium', 'low', 'info'] as const).flatMap((sev): [string, string][] => [
    [`sev-${sev}`, `sev-${sev}-soft`],
    [`sev-${sev}`, 'surface'],
  ]),
]

// Non-text UI boundaries (3:1): control borders, focus ring, filled buttons.
const UI_PAIRS: [string, string][] = [
  ['border-strong', 'surface'], ['border-strong', 'bg'], ['border-strong', 'surface-2'],
  ['focus', 'surface'], ['focus', 'bg'], ['focus', 'surface-2'],
  ['accent', 'surface'], ['accent', 'bg'],
]

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme tokens (C1 / C9)', (_name, tokens) => {
  it.each(TEXT_PAIRS)('%s on %s meets 4.5:1', (fg, bg) => {
    expect(tokens[fg], fg).toBeDefined()
    expect(tokens[bg], bg).toBeDefined()
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(UI_PAIRS)('%s on %s meets 3:1', (fg, bg) => {
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(3)
  })
})

describe('token sets', () => {
  it('dark defines a value for every colour light defines', () => {
    const darkOwn = block(":root[data-theme='dark']")
    const colourNames = Object.keys(light)
    expect(colourNames.filter((name) => !(name in darkOwn))).toEqual([])
  })
})
