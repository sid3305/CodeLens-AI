/**
 * Theme preference: follows the OS by default; an explicit choice is kept in
 * localStorage. Storage can be unavailable (private mode, blocked site data),
 * so every access is guarded. The same logic runs inline in index.html before
 * first paint to avoid a flash of the wrong theme.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'codelens-theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Storage unavailable: fall back to the system preference.
  }
  return 'system'
}

export function writePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

export function systemTheme(): ResolvedTheme {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
    ? 'dark'
    : 'light'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', theme === 'dark' ? '#0e1116' : '#f6f7f9')
}

export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(DARK_QUERY)
  const listener = () => onChange(query.matches ? 'dark' : 'light')
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
