import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from './api'

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('saved summary (Stage 3 leftover)', () => {
  it('no summary yet is an empty 200, read as null', async () => {
    respond(200, null)
    await expect(api.getSummary('r1')).resolves.toBeNull()
  })

  it('an unknown repository is an error, not "no summary"', async () => {
    respond(404, { detail: 'Repository not found' })
    await expect(api.getSummary('r1')).rejects.toBeInstanceOf(ApiError)
  })
})
