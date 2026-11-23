import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// Pages are lazy-loaded; the first import of a page module under jsdom can
// take longer than the 1 s default.
configure({ asyncUtilTimeout: 10_000 })

// Never import application modules here: they would load before each test
// file's vi.mock() and keep the real API client (real network calls).

// No test may reach a real server: an unmocked request fails loudly.
// (Tests that exercise the client itself stub fetch with vi.stubGlobal.)
globalThis.fetch = (input: RequestInfo | URL) => {
  throw new Error(`Unmocked network request in a test: ${String(input)}`)
}

afterEach(() => {
  cleanup()
})
