import type { Kind } from './types'
export async function load(): Promise<Kind> {
  const mod = await import('./heavy')
  return mod.kind
}
