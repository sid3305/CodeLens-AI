/** Views of the Architecture page; the first is the default. */
export const ARCHITECTURE_VIEWS = ['tree', 'overview', 'circular', 'external', 'modules'] as const

export type ArchitectureView = (typeof ARCHITECTURE_VIEWS)[number]

export const DEFAULT_ARCHITECTURE_VIEW: ArchitectureView = ARCHITECTURE_VIEWS[0]

/** `?view=` (omitted for the default) and, for the tree, `?file=`. */
export function architectureSearch(view: ArchitectureView, file: string | null): Record<string, string> {
  const params: Record<string, string> = {}
  if (view !== DEFAULT_ARCHITECTURE_VIEW) params.view = view
  if (view === 'tree' && file) params.file = file
  return params
}
