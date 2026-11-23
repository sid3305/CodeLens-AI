import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render'
import { fakeJobServer } from '../../test/jobs'

import AppRoutes from '../../app/AppRoutes'
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
      listActiveJobs: vi.fn(async () => []),
      getAiConsent: vi.fn(async (id: string) => ({ repository_id: id, enabled: true, provider: 'Groq', model: 'test-model', configured: true, problem: null })),
      setAiConsent: vi.fn(),
    },
  }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  mockedApi.getRepositories.mockResolvedValue([])
  mockedApi.getSummary.mockResolvedValue(null)
})

describe('AppShell analysis notice (A3 / BUG-19, B3)', () => {
  it('does not claim success when analyzers were missing', async () => {
    const server = fakeJobServer(mockedApi)
    mockedApi.health.mockResolvedValue({ status: 'healthy' })
    mockedApi.getRepositories.mockResolvedValue([
      { id: 'r1', name: 'repo', source: 'zip', file_count: 1, created_at: '' },
    ])
    mockedApi.getFiles.mockResolvedValue({ repository_id: 'r1', total_files: 0, files: [] })
    mockedApi.getAnalysisResults.mockResolvedValue(null)
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />)
    await user.click(await screen.findByRole('button', { name: /run analysis/i }))
    await waitFor(() => expect(mockedApi.startAnalysisJob).toHaveBeenCalledWith('r1'))
    server.finish(server.latest('analysis').id, partialResult)

    // Shown in the notification and in the Overview's findings card.
    expect((await screen.findAllByText(/not run: semgrep/i)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/completed successfully/i)).not.toBeInTheDocument()
  })
})

const partialResult = {
  repository_id: 'r1',
  repository_name: 'repo',
  status: 'partial',
  analyzed_at: '',
  summary: {
    total_findings: 2, raw_total_findings: 2, duplicates_removed: 0,
    severity_counts: {}, category_counts: {}, tool_counts: {},
  },
  tool_status: {
    Ruff: { status: 'Completed', findings: 2, error: null },
    Semgrep: { status: 'Failed', findings: 0, error: 'not installed' },
  },
  findings: [],
}

describe('AppShell background jobs (B3)', () => {
  beforeEach(() => {
    mockedApi.health.mockResolvedValue({ status: 'healthy' })
    mockedApi.getRepositories.mockResolvedValue([{ id: 'r1', name: 'repo', source: 'zip', file_count: 1, created_at: '' }])
    mockedApi.getFiles.mockResolvedValue({ repository_id: 'r1', total_files: 0, files: [] })
    mockedApi.getAnalysisResults.mockResolvedValue(null)
  })

  it('shows analysis progress and can cancel it', async () => {
    const server = fakeJobServer(mockedApi)
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)

    await user.click(await screen.findByRole('button', { name: /run analysis/i }))
    await waitFor(() => expect(mockedApi.startAnalysisJob).toHaveBeenCalledTimes(1))
    const job = server.latest('analysis')
    server.progress(job.id, 0.25, 'Running Bandit (2 of 4)')

    const bar = await screen.findByRole('progressbar', { name: 'Analysis' })
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '25'))
    expect(screen.queryByRole('button', { name: /run analysis/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel analysis' }))

    expect(mockedApi.cancelJob).toHaveBeenCalledWith(job.id)
    expect(await screen.findByText('Analysis cancelled.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /run analysis/i })).toBeInTheDocument()
  })

  it('picks up a running analysis after a page refresh', async () => {
    const server = fakeJobServer(mockedApi)
    const running = server.add({ kind: 'analysis', repository_id: 'r1', status: 'running', progress: 0.5, message: 'Running Semgrep (3 of 4)' })

    renderWithProviders(<AppRoutes />)

    const bar = await screen.findByRole('progressbar', { name: 'Analysis' })
    expect(bar).toHaveAttribute('aria-valuetext', '50%, Running Semgrep (3 of 4)')
    expect(mockedApi.startAnalysisJob).not.toHaveBeenCalled()

    server.finish(running.id, { ...partialResult, status: 'completed', tool_status: { Ruff: { status: 'Completed', findings: 2, error: null } } })
    expect(await screen.findByRole('button', { name: /run analysis/i })).toBeInTheDocument()
  })

  it('reports a failed job with its message', async () => {
    const server = fakeJobServer(mockedApi)
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)

    await user.click(await screen.findByRole('button', { name: /run analysis/i }))
    await waitFor(() => expect(mockedApi.startAnalysisJob).toHaveBeenCalled())
    server.fail(server.latest('analysis').id, 'An analysis of this repository is currently running.')

    expect(await screen.findByText('An analysis of this repository is currently running.')).toBeInTheDocument()
  })

  it('shows import progress in the sidebar, including after a refresh', async () => {
    const server = fakeJobServer(mockedApi)
    server.add({ kind: 'import', status: 'running', message: 'Cloning owner/repo' })

    renderWithProviders(<AppRoutes />)

    const bar = await screen.findByRole('progressbar', { name: 'Import' })
    expect(bar).toHaveAttribute('aria-valuetext', 'Cloning owner/repo')
    expect(screen.getByRole('button', { name: 'Cancel import' })).toBeInTheDocument()
  })
})

describe('AppShell file selection (D5)', () => {
  const repos = [
    { id: 'r1', name: 'first', source: 'zip', file_count: 2, created_at: '' },
    { id: 'r2', name: 'second', source: 'zip', file_count: 1, created_at: '' },
  ]

  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  beforeEach(() => {
    mockedApi.health.mockResolvedValue({ status: 'healthy' })
    mockedApi.getRepositories.mockResolvedValue(repos)
    mockedApi.getAnalysisResults.mockRejectedValue(new Error('none'))
    mockedApi.getFiles.mockImplementation(async (id: string) => ({
      repository_id: id,
      total_files: 2,
      files:
        id === 'r1'
          ? [
              { path: 'a.py', name: 'a.py', extension: '.py' },
              { path: 'b.py', name: 'b.py', extension: '.py' },
            ]
          : [{ path: 'c.py', name: 'c.py', extension: '.py' }],
    }))
  })

  it('shows the content of the file selected last, whatever order responses arrive in', async () => {
    const slow = deferred<{ repository_id: string; path: string; content: string }>()
    mockedApi.getFileContent = vi.fn((_id: string, path: string) =>
      path === 'a.py'
        ? slow.promise
        : Promise.resolve({ repository_id: 'r1', path, content: 'content of b' }),
    )
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)

    await user.click(await screen.findByRole('treeitem', { name: 'a.py' }))
    await user.click(screen.getByRole('treeitem', { name: 'b.py' }))
    await screen.findByText('content of b')
    slow.resolve({ repository_id: 'r1', path: 'a.py', content: 'content of a' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.queryByText('content of a')).not.toBeInTheDocument()
    expect(screen.getByText('content of b')).toBeInTheDocument()
  })

  it('drops the previewed file when another repository is selected', async () => {
    mockedApi.getFileContent = vi.fn(async (_id: string, path: string) => ({
      repository_id: 'r1',
      path,
      content: `content of ${path}`,
    }))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)

    await user.click(await screen.findByRole('treeitem', { name: 'a.py' }))
    await screen.findByText('content of a.py')
    await user.click(screen.getByRole('link', { name: /^second/i }))

    await screen.findByRole('treeitem', { name: 'c.py' })
    expect(screen.queryByText('content of a.py')).not.toBeInTheDocument()
  })
})

describe('AppShell placeholders (A10 / BUG-10)', () => {
  it('does not show the unimplemented AI chat panel', async () => {
    mockedApi.health.mockResolvedValue({ status: 'healthy' })

    renderWithProviders(<AppRoutes />)
    await screen.findByText(/api connected/i)

    expect(screen.queryByPlaceholderText(/ask about your repository/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ai assistant/i)).not.toBeInTheDocument()
  })
})

describe('AppShell API status (A3 / BUG-18)', () => {
  it('reports the API as unreachable when the health check fails', async () => {
    mockedApi.health.mockRejectedValue(new TypeError('Failed to fetch'))
    mockedApi.getRepositories.mockRejectedValue(new TypeError('Failed to fetch'))

    renderWithProviders(<AppRoutes />)

    expect(await screen.findByText(/api unreachable/i)).toBeInTheDocument()
    expect(screen.queryByText(/api connected/i)).not.toBeInTheDocument()
  })

  it('reports the API as connected when the health check succeeds', async () => {
    mockedApi.health.mockResolvedValue({ status: 'healthy' })

    renderWithProviders(<AppRoutes />)

    expect(await screen.findByText(/api connected/i)).toBeInTheDocument()
  })
})

describe('AppShell link import focus (X1, B3)', () => {
  const imported = {
    id: 'g1', name: 'repo', source: 'github', file_count: 2, created_at: '',
    ref: 'main', focus_path: 'src', source_url: 'https://github.com/o/r/tree/main/src',
  }

  beforeEach(() => {
    mockedApi.health.mockResolvedValue({ status: 'healthy' })
    mockedApi.getRepositories.mockResolvedValue([])
    mockedApi.getAnalysisResults.mockResolvedValue(null)
    mockedApi.parseRepositoryLink = vi.fn().mockResolvedValue({
      host: 'github.com', owner: 'o', repo: 'r', ref: 'main', ref_kind: 'branch',
      focus_path: 'src', display: 'o/r @ main (src)', url: 'https://github.com/o/r/tree/main/src',
    })
    mockedApi.getFiles.mockResolvedValue({
      repository_id: 'g1', total_files: 2,
      files: [
        { path: 'README.md', name: 'README.md', extension: '.md' },
        { path: 'src/app.py', name: 'app.py', extension: '.py' },
      ],
    })
  })

  async function importLink(focus: string) {
    const server = fakeJobServer(mockedApi)
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)
    const input = await screen.findByLabelText(/repository link/i)
    await user.type(input, 'https://github.com/o/r/tree/main/src')
    await screen.findByText(/will import/i)
    await user.click(screen.getByRole('button', { name: /^import$/i }))

    await waitFor(() => expect(mockedApi.startLinkImportJob).toHaveBeenCalledWith('https://github.com/o/r/tree/main/src'))
    expect(await screen.findByRole('progressbar', { name: 'Import' })).toBeInTheDocument()
    mockedApi.getRepositories.mockResolvedValue([{ ...imported, focus_path: focus }])
    server.finish(server.latest('import').id, { ...imported, focus_path: focus }, 'g1')
  }

  it('opens the explorer on the folder the link pointed at', async () => {
    await importLink('src')

    expect(await screen.findByRole('treeitem', { name: 'app.py' })).toBeInTheDocument()
  })

  it('opens the file the link pointed at', async () => {
    mockedApi.getFileContent = vi.fn().mockResolvedValue({
      repository_id: 'g1', path: 'src/app.py', content: 'print("focused")',
    })

    await importLink('src/app.py')

    expect(await screen.findByText('print("focused")')).toBeInTheDocument()
  })
})

describe('AppShell repository switch (C4)', () => {
  it('cancels the previous repository’s in-flight requests', async () => {
    const repos = [
      { id: 'r1', name: 'first', source: 'zip', file_count: 2, created_at: '' },
      { id: 'r2', name: 'second', source: 'zip', file_count: 1, created_at: '' },
    ]
    const signals: Record<string, AbortSignal[]> = { r1: [], r2: [] }
    mockedApi.health.mockResolvedValue({ status: 'healthy' })
    mockedApi.getRepositories.mockResolvedValue(repos)
    // Requests for r1 never answer; r2 answers at once.
    const pendingFor = (id: string, signal: AbortSignal, value: unknown) => {
      signals[id].push(signal)
      return id === 'r1' ? new Promise(() => {}) : Promise.resolve(value)
    }
    mockedApi.getFiles.mockImplementation((id: string, signal: AbortSignal) =>
      pendingFor(id, signal, { repository_id: id, total_files: 0, files: [] }),
    )
    mockedApi.getAnalysisResults.mockImplementation((id: string, signal: AbortSignal) =>
      pendingFor(id, signal, null),
    )
    mockedApi.getSummary.mockImplementation((id: string, signal: AbortSignal) =>
      pendingFor(id, signal, null),
    )
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)

    await waitFor(() => expect(signals.r1.length).toBeGreaterThanOrEqual(3))
    expect(signals.r1.every((signal) => !signal.aborted)).toBe(true)

    await user.selectOptions(screen.getByLabelText('Repository'), 'r2')

    await waitFor(() => expect(signals.r1.every((signal) => signal.aborted)).toBe(true))
    expect(signals.r2.length).toBeGreaterThan(0)
    expect(signals.r2.every((signal) => !signal.aborted)).toBe(true)
  })
})
