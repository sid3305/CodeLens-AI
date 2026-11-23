import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// Pages are lazy-loaded; the first import of a page module under jsdom can
// take longer than the 1 s default.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
})
