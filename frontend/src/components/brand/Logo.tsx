/**
 * The CodeLens mark: a lens over code brackets. Drawn with theme tokens,
 * so it follows light and dark mode (public/favicon.svg mirrors it).
 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="shrink-0">
      <rect width="32" height="32" rx="7" className="fill-accent" />
      <g fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="stroke-on-accent">
        <circle cx="14" cy="14" r="7.5" />
        <path d="M19.6 19.6 25 25" />
        <path d="M12.4 11.2 9.8 14l2.6 2.8M15.6 11.2l2.6 2.8-2.6 2.8" />
      </g>
    </svg>
  )
}
