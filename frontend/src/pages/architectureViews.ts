/** Views of the Architecture page; the first is the default. */
export const ARCHITECTURE_VIEWS = ['overview', 'circular', 'external', 'modules'] as const

export type ArchitectureView = (typeof ARCHITECTURE_VIEWS)[number]
