import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import {
  applyTheme,
  readPreference,
  resolveTheme,
  systemTheme,
  watchSystemTheme,
  writePreference,
} from './theme'
import type { ResolvedTheme, ThemePreference } from './theme'

interface ThemeContextValue {
  preference: ThemePreference
  theme: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  const theme: ResolvedTheme = preference === 'system' ? system : resolveTheme(preference)

  useEffect(() => watchSystemTheme(setSystem), [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      theme,
      setPreference: (next) => {
        writePreference(next)
        setPreferenceState(next)
      },
    }),
    [preference, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>')
  return context
}
