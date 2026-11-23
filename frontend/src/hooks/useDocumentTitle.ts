import { useEffect } from 'react'

const APP_NAME = 'CodeLens AI'

/** Sets the tab title to "<parts> · CodeLens AI" (most specific first). */
export function useDocumentTitle(...parts: (string | null | undefined)[]) {
  const title = [...parts.filter(Boolean), APP_NAME].join(' · ')
  useEffect(() => {
    document.title = title
  }, [title])
}
