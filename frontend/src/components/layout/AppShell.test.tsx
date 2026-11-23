import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AppShell from './AppShell'
import { api } from '../../services/api'

vi.mock('../../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/api')>()
  return {
    ...original,
    api: {
      health: vi.fn(),
      getRepositories: vi.fn(),
      getFiles: vi.fn(),
      getAnalysisResults: vi.fn(),
      getSummary: vi.fn(),
    },
  }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  mockedApi.getRepositories.mockResolvedValue([])
  mockedApi.getSummary.mockResolvedValue(null)
})

describe('AppShell analysis notice (A3 / BUG-19)', () => {
  it('does not claim success when analyzers were missing', async () => {
    mockedApi.health.mockResolvedValue({ status: 'healthy' })
    mockedApi.getRepositories.mockResolvedValue([
      { id: 'r1', name: 'repo', source: 'zip', file_count: 1, created_at: '' },
    ])
    mockedApi.getFiles.mockResolvedValue({ repository_id: 'r1', total_files: 0, files: [] })
    mockedApi.getAnalysisResults.mockRejectedValue(new Error('none'))
    mockedApi.analyzeRepository = vi.fn().mockResolvedValue({
      repository_id: 'r1',
      repository_name: 'repo',
      status: 'partial',
      analyzed_at: '',
      summary: {
        total_findings: 2,
        raw_total_findings: 2,
        duplicates_removed: 0,
        severity_counts: {},
        category_counts: {},
        tool_counts: {},
      },
      tool_status: {
        Ruff: { status: 'Completed', findings: 2, error: null },
        Semgrep: { status: 'Failed', findings: 0, error: 'not installed' },
      },
      findings: [],
    })
    const user = userEvent.setup()

    render(<AppShell />)
    await user.click(await screen.findByRole('button', { name: /run analysis/i }))

    expect(await screen.findByText(/not run: semgrep/i)).toBeInTheDocument()
    expect(screen.queryByText(/completed successfully/i)).not.toBeInTheDocument()
  })
})

describe('AppShell placeholders (A10 / BUG-10)', () => {
  it('does not show the unimplemented AI chat panel', async () => {
    mockedApi.health.mockResolvedValue({ status: 'healthy' })

    render(<AppShell />)
    await screen.findByText(/api connected/i)

    expect(screen.queryByPlaceholderText(/ask about your repository/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ai assistant/i)).not.toBeInTheDocument()
  })
})

describe('AppShell API status (A3 / BUG-18)', () => {
  it('reports the API as unreachable when the health check fails', async () => {
    mockedApi.health.mockRejectedValue(new TypeError('Failed to fetch'))
    mockedApi.getRepositories.mockRejectedValue(new TypeError('Failed to fetch'))

    render(<AppShell />)

    expect(await screen.findByText(/api unreachable/i)).toBeInTheDocument()
    expect(screen.queryByText(/api connected/i)).not.toBeInTheDocument()
  })

  it('reports the API as connected when the health check succeeds', async () => {
    mockedApi.health.mockResolvedValue({ status: 'healthy' })

    render(<AppShell />)

    expect(await screen.findByText(/api connected/i)).toBeInTheDocument()
  })
})
