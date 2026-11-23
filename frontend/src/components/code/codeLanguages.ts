import type { Extension } from '@codemirror/state'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'

/** Python and JavaScript/TypeScript are highlighted; anything else is plain text. */
export function languageFor(path: string): Extension | null {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (extension === '.py' || extension === '.pyi') return python()
  if (['.js', '.mjs', '.cjs'].includes(extension)) return javascript()
  if (extension === '.jsx') return javascript({ jsx: true })
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return javascript({ typescript: true })
  if (extension === '.tsx') return javascript({ typescript: true, jsx: true })
  return null
}

