import { describe, expect, it } from 'vitest'

import { ApiError } from '../services/api'
import { createQueryClient, queryKeys, retryDelay, shouldRetry } from './queryClient'

describe('retry policy (C4)', () => {
  it('retries idempotent reads on server and network errors, at most twice', () => {
    expect(shouldRetry(0, new ApiError('boom', 500))).toBe(true)
    expect(shouldRetry(1, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetry(2, new ApiError('boom', 503))).toBe(false)
  })

  it('never retries client errors or cancelled requests', () => {
    expect(shouldRetry(0, new ApiError('missing', 404))).toBe(false)
    expect(shouldRetry(0, new ApiError('bad input', 400))).toBe(false)
    expect(shouldRetry(0, new DOMException('aborted', 'AbortError'))).toBe(false)
  })

  it('backs off exponentially with a cap', () => {
    expect(retryDelay(0)).toBe(500)
    expect(retryDelay(1)).toBe(1000)
    expect(retryDelay(10)).toBe(8000)
  })

  it('never retries mutations (imports, analysis, LLM calls)', () => {
    const client = createQueryClient()
    expect(client.getDefaultOptions().mutations?.retry).toBe(false)
  })
})

describe('query keys (C4)', () => {
  it('scope every repository read by repository id', () => {
    const keys = [
      queryKeys.files('x'),
      queryKeys.analysis('x'),
      queryKeys.summary('x'),
      queryKeys.dependencies('x'),
      queryKeys.fileContent('x', 'a.py'),
      queryKeys.explanation('x', 'a.py'),
    ]
    for (const key of keys) expect(key.slice(0, 2)).toEqual(['repository', 'x'])
  })
})
