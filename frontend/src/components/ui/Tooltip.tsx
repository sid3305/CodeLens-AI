import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ReactElement, ReactNode } from 'react'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  )
}

/** Supplementary text on hover/focus. Never the only source of a name. */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={6}
          className="z-[var(--cl-z-tooltip)] rounded-sm bg-fg px-2 py-1 text-xs text-bg shadow-md"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
