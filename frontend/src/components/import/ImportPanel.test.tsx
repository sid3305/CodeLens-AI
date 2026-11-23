import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ImportPanel from './ImportPanel'
import { ApiError, api } from '../../services/api'

vi.mock('../../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/api')>()
  return { ...original, api: { parseRepositoryLink: vi.fn() } }
})

const parse = api.parseRepositoryLink as unknown as ReturnType<typeof vi.fn>

function preview(display: string) {
  return {
    host: 'github.com', owner: 'o', repo: 'r', ref: 'main', ref_kind: 'branch',
    focus_path: null, display, url: 'https://github.com/o/r/tree/main',
  }
}

function setup() {
  const onImportZip = vi.fn(async () => {})
  const onImportLink = vi.fn(async () => {})
  render(<ImportPanel onImportZip={onImportZip} onImportLink={onImportLink} importing={false} />)
  return { onImportZip, onImportLink, input: screen.getByLabelText(/repository link/i) }
}

beforeEach(() => {
  parse.mockReset()
})

describe('ImportPanel (X1)', () => {
  it('shows the normalised repository before importing', async () => {
    parse.mockResolvedValue(preview('o/r @ main'))
    const user = userEvent.setup()
    const { input, onImportLink } = setup()

    await user.type(input, 'https://github.com/o/r/tree/main')

    expect(await screen.findByText('Will import o/r @ main')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^import$/i }))
    expect(onImportLink).toHaveBeenCalledWith('https://github.com/o/r/tree/main')
  })

  it('explains why a link is rejected and blocks the import', async () => {
    parse.mockRejectedValue(new ApiError('Only https:// links are supported. Example: https://github.com/owner/repository', 400))
    const user = userEvent.setup()
    const { input } = setup()

    await user.type(input, 'file:///etc/passwd')

    expect(await screen.findByText(/only https:\/\/ links are supported/i)).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled()
  })

  it('ignores a slow validation result for text that was since replaced', async () => {
    let resolveFirst!: (value: unknown) => void
    parse
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(preview('second/repo @ default branch'))
    const { input } = setup()

    fireEvent.change(input, { target: { value: 'first/repo' } })
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
    fireEvent.change(input, { target: { value: 'second/repo' } })
    await screen.findByText('Will import second/repo @ default branch')

    await act(async () => resolveFirst(preview('first/repo @ default branch')))

    expect(screen.queryByText(/first\/repo/)).not.toBeInTheDocument()
    expect(screen.getByText('Will import second/repo @ default branch')).toBeInTheDocument()
  })

  it('imports a ZIP chosen with the file picker', async () => {
    const user = userEvent.setup()
    const { onImportZip } = setup()
    const file = new File(['zip'], 'repo.zip', { type: 'application/zip' })

    await user.upload(screen.getByLabelText(/zip archive/i), file)

    expect(onImportZip).toHaveBeenCalledWith(file)
  })

  it('imports a ZIP dropped onto the panel and rejects other files', async () => {
    const { onImportZip } = setup()
    const zone = screen.getByRole('group', { name: /import a repository/i })
    const zip = new File(['zip'], 'repo.zip', { type: 'application/zip' })

    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'notes.txt')] } })
    expect(await screen.findByText(/drop a \.zip file/i)).toBeInTheDocument()

    fireEvent.drop(zone, { dataTransfer: { files: [zip] } })
    expect(onImportZip).toHaveBeenCalledWith(zip)
  })
})
