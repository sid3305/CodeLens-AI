import { createContext } from 'react'

/** Opens a repository file in the preview; provided by the Architecture page. */
export const OpenFileContext = createContext<((path: string) => void) | null>(null)
