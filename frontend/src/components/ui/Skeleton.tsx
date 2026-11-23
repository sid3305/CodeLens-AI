import { cn } from './cn'

/** Loading placeholder. Hidden from assistive tech; pair with a status text. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-sm bg-surface-2', className)}
    />
  )
}

/** Accessible loading state: visible skeletons plus a status announcement. */
export function LoadingBlock({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div className="space-y-2 py-2">
      <p role="status" className="sr-only">{label}</p>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-4', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}
