import type { FindingFilters } from '../components/workspace/findingFilters'
import type { WorkspaceSection } from '../types'

/** Sections reachable from the navigation (the file preview is reached by opening a file). */
export type NavSection = Exclude<WorkspaceSection, 'file-preview'>

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export const paths = {
  home: '/',
  repository: (repoId: string) => `/repo/${encodeURIComponent(repoId)}`,
  section: (repoId: string, section: NavSection) => `/repo/${encodeURIComponent(repoId)}/${section}`,
  /** `/repo/:id/files/<path>#L<line>`; without a path, the empty preview. */
  file: (repoId: string, path: string | null = null, line: number | null = null) =>
    `/repo/${encodeURIComponent(repoId)}/files${path ? `/${encodePath(path)}` : ''}${line ? `#L${line}` : ''}`,
}

/** The section a pathname shows, or null outside a repository. */
export function sectionFromPath(pathname: string): WorkspaceSection | null {
  const segment = pathname.split('/')[3]
  if (segment === 'overview' || segment === 'architecture' || segment === 'issues') return segment
  if (segment === 'files') return 'file-preview'
  return null
}

/** `#L12` → 12; anything else → null. */
export function lineFromHash(hash: string): number | null {
  const match = /^#L(\d{1,7})$/.exec(hash)
  if (!match) return null
  const line = Number(match[1])
  return line > 0 ? line : null
}

export const DEFAULT_FILTERS: FindingFilters = { query: '', severity: 'All', analyzer: 'All' }

/** `?severity=&q=&analyzer=` → filters; missing or empty values mean "All". */
export function filtersFromSearch(params: URLSearchParams): FindingFilters {
  return {
    query: params.get('q') ?? '',
    severity: params.get('severity') || 'All',
    analyzer: params.get('analyzer') || 'All',
  }
}

/** Only non-default filters go into the URL. */
export function filtersToSearch(filters: FindingFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.severity !== 'All') params.set('severity', filters.severity)
  if (filters.query) params.set('q', filters.query)
  if (filters.analyzer !== 'All') params.set('analyzer', filters.analyzer)
  return params
}
