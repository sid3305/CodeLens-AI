import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render'

import FilePreviewPage from './FilePreviewPage'
import OverviewPage from './OverviewPage'
import { ApiError, api } from '../services/api'
import type { Repository } from '../types'

vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/api')>()
  return {
    ...original,
    api: {
      getFiles: vi.fn(),
      getAnalysisResults: vi.fn(),
      getSummary: vi.fn(),
      listActiveJobs: vi.fn(async () => []),
      getAiConsent: vi.fn(async (id: string) => ({ repository_id: id, enabled: true, provider: 'Groq', model: 'test-model', configured: true, problem: null })),
      setAiConsent: vi.fn(),
      generateSummary: vi.fn(),
      getFileContent: vi.fn(),
      explainFile: vi.fn(),
    },
  }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const repoA: Repository = { id: 'aaaa', name: 'repo-a', source: 'zip', file_count: 2, created_at: '' }
const repoB: Repository = { id: 'bbbb', name: 'repo-b', source: 'zip', file_count: 2, created_at: '' }

function summaryFor(repo: Repository) {
  return {
    repository_id: repo.id,
    repository_name: repo.name,
    summary: `Summary of ${repo.name}`,
    generated_at: '2026-01-01T00:00:00Z',
    truncated: false,
  }
}

function explanationOf(path: string) {
  return {
    repository_id: repoA.id,
    file_path: path,
    explanation: `Explanation of ${path}`,
    generated_at: '2026-01-01T00:00:00Z',
    truncated: false,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const overview = (repo: Repository) => <OverviewPage key={repo.id} repository={repo} />
const preview = (path: string | null) => (
  <FilePreviewPage key={`${repoA.id}:${path}`} repository={repoA} path={path} line={null} />
)

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.getAiConsent.mockImplementation(async (id: string) => ({ repository_id: id, enabled: true, provider: 'Groq', model: 'test-model', configured: true, problem: null }))
  mockedApi.getFiles.mockImplementation(async (id: string) => ({ repository_id: id, total_files: 0, files: [] }))
  mockedApi.getAnalysisResults.mockResolvedValue(null)
  mockedApi.getSummary.mockResolvedValue(null)
  mockedApi.generateSummary.mockImplementation(async (id: string) =>
    summaryFor(id === repoA.id ? repoA : repoB),
  )
  mockedApi.getFileContent.mockImplementation(async (id: string, path: string) => ({
    repository_id: id,
    path,
    content: `content of ${path}`,
  }))
  mockedApi.explainFile.mockImplementation(async (_id: string, path: string) => explanationOf(path))
})

describe('Overview AI summary (A1 / BUG-02, BUG-03)', () => {
  it('never sends code to the LLM without an explicit click', async () => {
    renderWithProviders(overview(repoA))

    await waitFor(() => expect(mockedApi.getSummary).toHaveBeenCalled())
    expect(mockedApi.getSummary.mock.calls[0][0]).toBe(repoA.id)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(mockedApi.generateSummary).not.toHaveBeenCalled()
  })

  it('does not retry automatically after a failed generation', async () => {
    mockedApi.generateSummary.mockRejectedValue(new Error('Invalid API Key'))
    const user = userEvent.setup()
    renderWithProviders(overview(repoA))

    await user.click(await screen.findByRole('button', { name: /generate ai summary/i }))
    await screen.findByText(/invalid api key/i)

    await act(() => new Promise((resolve) => setTimeout(resolve, 200)))
    expect(mockedApi.generateSummary).toHaveBeenCalledTimes(1)
  })

  it('never shows one repository’s summary for another', async () => {
    mockedApi.getSummary.mockImplementation(async (id: string) =>
      id === repoA.id ? summaryFor(repoA) : null,
    )
    const { rerender } = renderWithProviders(overview(repoA))
    await screen.findByText('Summary of repo-a')

    rerender(overview(repoB))

    await waitFor(() => expect(mockedApi.getSummary.mock.calls.some(([id]) => id === repoB.id)).toBe(true))
    expect(screen.queryByText('Summary of repo-a')).not.toBeInTheDocument()
  })
})

describe('Overview regenerate (A2 / BUG-05)', () => {
  it('asks the backend to bypass the saved summary', async () => {
    mockedApi.getSummary.mockResolvedValue(summaryFor(repoA))
    const user = userEvent.setup()
    renderWithProviders(overview(repoA))

    await user.click(await screen.findByRole('button', { name: /regenerate summary/i }))

    expect(mockedApi.generateSummary).toHaveBeenCalledWith(repoA.id, { force: true })
  })
})

describe('Overview (A10)', () => {
  it('does not present a made-up repository health metric', async () => {
    renderWithProviders(overview(repoA))
    await waitFor(() => expect(mockedApi.getSummary).toHaveBeenCalled())

    expect(screen.queryByText(/repository health/i)).not.toBeInTheDocument()
  })
})

describe('LLM calls are never retried (C4)', () => {
  // A 500 is retried for reads (see queryClient.test), so this proves the
  // LLM paths opt out rather than merely failing with a non-retryable error.
  it('summary generation is sent once even on a server error', async () => {
    mockedApi.generateSummary.mockRejectedValue(new ApiError('AI service error', 502))
    const user = userEvent.setup()
    renderWithProviders(overview(repoA))

    await user.click(await screen.findByRole('button', { name: /generate ai summary/i }))
    await screen.findByText(/ai service error/i)
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))

    expect(mockedApi.generateSummary).toHaveBeenCalledTimes(1)
  })

  it('file explanation is sent once even on a server error', async () => {
    mockedApi.explainFile.mockRejectedValue(new ApiError('AI service error', 503))
    const user = userEvent.setup()
    renderWithProviders(preview('a.py'))

    await user.click(await screen.findByRole('button', { name: /explain this file/i }))
    await screen.findByRole('alert')
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))

    expect(mockedApi.explainFile).toHaveBeenCalledTimes(1)
  })
})

describe('File preview sections (A10)', () => {
  it('guides the user instead of showing a placeholder when no file is selected', () => {
    renderWithProviders(preview(null))

    expect(screen.getByText(/select a file in the explorer/i)).toBeInTheDocument()
    expect(screen.queryByText(/later milestone/i)).not.toBeInTheDocument()
  })
})

describe('File preview error surfacing (A3 / BUG-17)', () => {
  it('shows why a file explanation failed', async () => {
    mockedApi.explainFile.mockRejectedValue(new Error('AI service error: rate limited'))
    const user = userEvent.setup()
    renderWithProviders(preview('a.py'))

    await user.click(await screen.findByRole('button', { name: /explain this file/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/rate limited/i)
  })
})

describe('File preview explanation (A1 / BUG-04, C4)', () => {
  it('clears the explanation when a different file is opened', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(preview('a.py'))

    await screen.findByText('content of a.py')
    await user.click(screen.getByRole('button', { name: /explain this file/i }))
    await screen.findByText('Explanation of a.py')

    rerender(preview('b.py'))

    await screen.findByText('content of b.py')
    expect(screen.queryByText('Explanation of a.py')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /explain this file/i })).toBeInTheDocument()
  })

  it('never renders a late explanation under the wrong file', async () => {
    const slow = deferred<ReturnType<typeof explanationOf>>()
    mockedApi.explainFile.mockImplementation((_id: string, path: string) =>
      path === 'a.py' ? slow.promise : Promise.resolve(explanationOf(path)),
    )
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(preview('a.py'))

    await user.click(await screen.findByRole('button', { name: /explain this file/i }))
    rerender(preview('b.py'))
    await screen.findByText('content of b.py')

    await act(async () => slow.resolve(explanationOf('a.py')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    expect(screen.queryByText('Explanation of a.py')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /explain this file/i })).not.toBeDisabled()

    // The answer is kept for the file it belongs to.
    rerender(preview('a.py'))
    expect(await screen.findByText('Explanation of a.py')).toBeInTheDocument()
  })

  it('never renders late file content under the wrong file', async () => {
    const slow = deferred<{ repository_id: string; path: string; content: string }>()
    mockedApi.getFileContent.mockImplementation((id: string, path: string) =>
      path === 'a.py' ? slow.promise : Promise.resolve({ repository_id: id, path, content: `content of ${path}` }),
    )
    const { rerender } = renderWithProviders(preview('a.py'))

    rerender(preview('b.py'))
    await screen.findByText('content of b.py')
    await act(async () => slow.resolve({ repository_id: repoA.id, path: 'a.py', content: 'content of a.py' }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    expect(screen.queryByText('content of a.py')).not.toBeInTheDocument()
    expect(screen.getByText('content of b.py')).toBeInTheDocument()
  })
})

describe('AI consent gates every AI action (B6)', () => {
  beforeEach(() => {
    mockedApi.getAiConsent.mockImplementation(async (id: string) => ({ repository_id: id, enabled: false, provider: 'Groq', model: 'test-model', configured: true, problem: null }))
  })

  it('the summary cannot be generated until AI is allowed', async () => {
    renderWithProviders(overview(repoA))

    expect(await screen.findByText(/AI is off for this repository/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate ai summary/i })).toBeDisabled()
    expect(screen.getByText(/send up to 30,000 characters of this repository's source code to Groq \(test-model\)/)).toBeInTheDocument()
    expect(mockedApi.generateSummary).not.toHaveBeenCalled()
  })

  it('a file cannot be explained until AI is allowed', async () => {
    renderWithProviders(preview('a.py'))

    expect(await screen.findByText(/AI is off for this repository/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /explain this file/i })).toBeDisabled()
    expect(mockedApi.explainFile).not.toHaveBeenCalled()
  })

  it('allowing AI enables the action without sending anything by itself', async () => {
    mockedApi.setAiConsent.mockImplementation(async (id: string, enabled: boolean) => ({ repository_id: id, enabled, provider: 'Groq', model: 'test-model', configured: true, problem: null }))
    const user = userEvent.setup()
    renderWithProviders(preview('a.py'))

    await user.click(await screen.findByRole('button', { name: 'Allow AI for this repository' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /explain this file/i })).toBeEnabled())
    expect(mockedApi.explainFile).not.toHaveBeenCalled()
  })
})
