import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render'

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

    renderWithProviders(<AppRoutes />)
    await user.click(await screen.findByRole('button', { name: /run analysis/i }))

    // Shown in the notification and in the Overview's findings card.
    expect((await screen.findAllByText(/not run: semgrep/i)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/completed successfully/i)).not.toBeInTheDocument()
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

describe('AppShell link import focus (X1)', () => {
  const imported = {
    id: 'g1', name: 'repo', source: 'github', file_count: 2, created_at: '',
    ref: 'main', focus_path: 'src', source_url: 'https://github.com/o/r/tree/main/src',
  }

  beforeEach(() => {
    mockedApi.health.mockResolvedValue({ status: 'healthy' })
    mockedApi.getRepositories.mockResolvedValue([])
    mockedApi.getAnalysisResults.mockRejectedValue(new Error('none'))
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
    mockedApi.importGitHub = vi.fn().mockImplementation(async () => {
      mockedApi.getRepositories.mockResolvedValue([{ ...imported, focus_path: focus }])
      return { ...imported, focus_path: focus }
    })
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />)
    const input = await screen.findByLabelText(/repository link/i)
    await user.type(input, 'https://github.com/o/r/tree/main/src')
    await screen.findByText(/will import/i)
    await user.click(screen.getByRole('button', { name: /^import$/i }))
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
