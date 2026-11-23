import { useOutletContext } from 'react-router'

import type { Repository } from '../types'

/** What the shell hands to every route below it. */
export interface ShellContext {
  repositories: Repository[]
  repositoriesPending: boolean
  importing: boolean
  onImportZip: (file: File) => Promise<boolean>
  onImportLink: (url: string) => Promise<boolean>
  onOpenFile: (repoId: string, path: string, line?: number | null) => void
}

/** Routes under /repo/:repoId also get the repository they show. */
export interface RepositoryContext extends ShellContext {
  repository: Repository
}

export const useShell = () => useOutletContext<ShellContext>()
export const useRepositoryContext = () => useOutletContext<RepositoryContext>()
