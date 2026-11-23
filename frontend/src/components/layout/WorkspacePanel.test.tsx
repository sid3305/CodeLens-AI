import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

import WorkspacePanel from './WorkspacePanel'
import { api } from '../../services/api'
import type { Repository } from '../../types'

vi.mock('../../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/api')>()
  return {
    ...original,
    api: {
      getSummary: vi.fn(),
      generateSummary: vi.fn(),
      explainFile: vi.fn(),
      getDependenciesAnalysis: vi.fn(),
    },
  }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const repoA: Repository = { id: 'aaaa', name: 'repo-a', source: 'zip', file_count: 2 }
const repoB: Repository = { id: 'bbbb', name: 'repo-b', source: 'zip', file_count: 2 }

function summaryFor(repo: Repository) {
  return {
    repository_id: repo.id,
    repository_name: repo.name,
    summary: `Summary of ${repo.name}`,
    generated_at: '2026-01-01T00:00:00Z',
    truncated: false,
  }
}

type Props = ComponentProps<typeof WorkspacePanel>

function props(overrides: Partial<Props> = {}): Props {
  return {
    activeSection: 'overview',
    repository: repoA,
    files: [],
    analysis: null,
    selectedFilePath: null,
    selectedFileContent: null,
    onRunAnalysis: vi.fn(),
    analyzing: false,
    onRefresh: vi.fn(),
    onImportZip: vi.fn(async () => {}),
    onImportGitHub: vi.fn(async () => {}),
    selectedLine: null,
    onOpenFinding: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  mockedApi.getSummary.mockResolvedValue(null)
  mockedApi.generateSummary.mockImplementation(async (id: string) =>
    summaryFor(id === repoA.id ? repoA : repoB),
  )
})

describe('WorkspacePanel AI summary (A1 / BUG-02, BUG-03)', () => {
  it('never sends code to the LLM without an explicit click', async () => {
    render(<WorkspacePanel {...props()} />)

    await waitFor(() => expect(mockedApi.getSummary).toHaveBeenCalledWith(repoA.id))
    expect(mockedApi.generateSummary).not.toHaveBeenCalled()
  })

  it('does not retry automatically after a failed generation', async () => {
    mockedApi.generateSummary.mockRejectedValue(new Error('Invalid API Key'))
    const user = userEvent.setup()
    render(<WorkspacePanel {...props()} />)

    await user.click(await screen.findByRole('button', { name: /generate ai summary/i }))
    await screen.findByText(/invalid api key/i)

    await act(() => new Promise((resolve) => setTimeout(resolve, 200)))
    expect(mockedApi.generateSummary).toHaveBeenCalledTimes(1)
  })

  it('never shows one repository’s summary for another', async () => {
    mockedApi.getSummary.mockImplementation(async (id: string) =>
      id === repoA.id ? summaryFor(repoA) : null,
    )
    const { rerender } = render(<WorkspacePanel {...props()} />)
    await screen.findByText('Summary of repo-a')

    rerender(<WorkspacePanel {...props({ repository: repoB })} />)

    await waitFor(() => expect(mockedApi.getSummary).toHaveBeenCalledWith(repoB.id))
    expect(screen.queryByText('Summary of repo-a')).not.toBeInTheDocument()
  })
})

describe('WorkspacePanel regenerate (A2 / BUG-05)', () => {
  it('asks the backend to bypass the saved summary', async () => {
    mockedApi.getSummary.mockResolvedValue(summaryFor(repoA))
    const user = userEvent.setup()
    render(<WorkspacePanel {...props()} />)

    await user.click(await screen.findByRole('button', { name: /regenerate summary/i }))

    expect(mockedApi.generateSummary).toHaveBeenCalledWith(repoA.id, { force: true })
  })
})

describe('WorkspacePanel file explanation (A1 / BUG-04)', () => {
  it('clears the explanation when a different file is opened', async () => {
    mockedApi.explainFile.mockImplementation(async (_id: string, path: string) => ({
      repository_id: repoA.id,
      file_path: path,
      explanation: `Explanation of ${path}`,
      generated_at: '2026-01-01T00:00:00Z',
      truncated: false,
    }))
    const user = userEvent.setup()
    const base = props({
      activeSection: 'file-preview',
      selectedFilePath: 'a.py',
      selectedFileContent: 'x = 1',
    })
    const { rerender } = render(<WorkspacePanel {...base} />)

    await user.click(screen.getByRole('button', { name: /explain this file/i }))
    await screen.findByText('Explanation of a.py')

    rerender(
      <WorkspacePanel
        {...base}
        selectedFilePath="b.py"
        selectedFileContent="y = 2"
      />,
    )

    expect(screen.queryByText('Explanation of a.py')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /explain this file/i })).toBeInTheDocument()
  })
})
