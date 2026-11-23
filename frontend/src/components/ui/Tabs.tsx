import * as RadixTabs from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'

import { cn } from './cn'

export function Tabs({
  value,
  onValueChange,
  children,
}: {
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange}>
      {children}
    </RadixTabs.Root>
  )
}

export function TabsList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RadixTabs.List
      aria-label={label}
      className="flex gap-1 overflow-x-auto border-b border-border px-1"
    >
      {children}
    </RadixTabs.List>
  )
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixTabs.Trigger
      value={value}
      className={cn(
        '-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-fg-muted',
        'hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg',
      )}
    >
      {children}
    </RadixTabs.Trigger>
  )
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixTabs.Content value={value} className="pt-4 focus-visible:outline-none">
      {children}
    </RadixTabs.Content>
  )
}
