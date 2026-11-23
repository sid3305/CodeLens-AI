import { useEffect, useRef } from 'react'

const WAIT_FOR_HEADING_MS = 5000

/**
 * After the page changes (a new pathname, not on first load), move focus to
 * the new page's h1 inside `containerId`, so keyboard and screen-reader
 * users land on the new content. Lazy pages render later: wait for the h1.
 * Query or hash changes (filters, selections, #L lines) do not move focus.
 */
export function useFocusHeadingOnNavigation(pathname: string, containerId: string) {
  const previous = useRef(pathname)

  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname

    const container = document.getElementById(containerId)
    if (!container) return

    const focusHeading = () => {
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
  }, [pathname, containerId])
}
