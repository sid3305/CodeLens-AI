import { Monitor, Moon, Sun } from 'lucide-react'

import { useTheme } from '../../theme/ThemeProvider'
import type { ThemePreference } from '../../theme/theme'
import { cn } from '../ui'

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'System theme', Icon: Monitor },
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
]

/** Three-way theme switch; the current choice is exposed with aria-pressed. */
export default function ThemeToggle() {
  const { preference, setPreference } = useTheme()

  return (
    <div role="group" aria-label="Theme" className="inline-flex rounded-sm border border-border-strong bg-surface p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-[4px] text-fg-muted hover:text-fg',
            preference === value && 'bg-accent-soft text-accent-text',
          )}
        >
          <Icon size={14} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
