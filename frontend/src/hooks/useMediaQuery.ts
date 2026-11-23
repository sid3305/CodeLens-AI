import { useSyncExternalStore } from 'react'

/**
 * Subscribe to a CSS media query. Without matchMedia (old test DOMs) the
 * fallback is returned, so layouts default to their desktop form.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    () => fallback,
  )
}

/** The sidebar is inline from this width; below it, it is an off-canvas drawer. */
export const DESKTOP_QUERY = '(min-width: 1024px)'
