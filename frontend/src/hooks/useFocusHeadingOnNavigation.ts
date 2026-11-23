import { useEffect, useRef } from 'react'
import { useNavigationType } from 'react-router'

const WAIT_FOR_HEADING_MS = 5000

/**
 * After the page changes (a new pathname from a link or back/forward, not on
 * first load and not on a redirect), move focus to the new page's h1 inside
 * `containerId`. Lazy pages render later: wait for the h1, but never take
 * focus from something the user moved to in the meantime.
 */
export function useFocusHeadingOnNavigation(pathname: string, containerId: string) {
  const previous = useRef(pathname)
  const navigationType = useNavigationType()

  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    // Redirects (e.g. / -> the first repository) are not the user's navigation.
    if (navigationType === 'REPLACE') return

    const container = document.getElementById(containerId)
    if (!container) return
    const focusedAtNavigation = document.activeElement

    const focusHeading = () => {
      const active = document.activeElement
      if (active !== focusedAtNavigation && active !== document.body && !container.contains(active)) return true
      const heading = container.querySelector('h1')
      if (!heading) return false
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
      heading.focus()
      return true
    }
    if (focusHeading()) return

    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect()
    })
    observer.observe(container, { childList: true, subtree: true })
    const timer = window.setTimeout(() => observer.disconnect(), WAIT_FOR_HEADING_MS)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [pathname, containerId, navigationType])
}
