import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const html = readFileSync(join(root, 'index.html'), 'utf8')

describe('branding (C11)', () => {
  it('names the app and describes it', () => {
    expect(html).toContain('<title>CodeLens AI</title>')
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/)
  })

  it('sets theme-color, and updates it before first paint in dark mode', () => {
    expect(html).toContain('<meta name="theme-color" content="#f6f7f9" />')
    expect(html).toContain("meta.setAttribute('content', dark ? '#0e1116' : '#f6f7f9')")
  })

  it('uses the CodeLens favicon with a dark variant', () => {
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
    const favicon = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8')
    expect(favicon).toContain('<title>CodeLens AI</title>')
    expect(favicon).toContain('prefers-color-scheme: dark')
  })

  it('ships none of the Vite template assets', () => {
    for (const file of ['src/assets/hero.png', 'src/assets/react.svg', 'src/assets/vite.svg', 'public/icons.svg']) {
      expect(existsSync(join(root, file)), file).toBe(false)
    }
  })
})
