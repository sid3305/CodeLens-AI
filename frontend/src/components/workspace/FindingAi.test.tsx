import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import FindingCard from './FindingCard'
import { ApiError, api } from '../../services/api'
import { renderWithProviders } from '../../test/render'
import type { Finding } from '../../types'

vi.mock('../../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/api')>()
  return {
    ...original,
    api: { getAiConsent: vi.fn(), setAiConsent: vi.fn(), findingAi: vi.fn(), getFileContent: vi.fn() },
  }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const finding = (id: string, line: number | null = 30) => ({
  id, title: `Finding ${id}`, category: 'Security', severity: 'Medium', confidence: '', file: 'app/main.py',
  line, end_line: null, column: null, rule_id: 'S105', description: 'Hardcoded credential', recommendation: '',
  detected_by: ['Ruff'], tool_details: [], duplicate_count: 0,
}) as unknown as Finding

const consent = (enabled: boolean) => ({ repository_id: 'r1', enabled, provider: 'Groq', model: 'test-model', configured: true, problem: null })

function answer(id: string, mode: 'explain' | 'fix', text: string) {
  return { repository_id: 'r1', finding_id: id, mode, text, generated_at: '', sent: { file: 'app/main.py', start_line: 20, end_line: 40 } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.getAiConsent.mockResolvedValue(consent(true))
})

const card = (item = finding('F1')) => (
  <FindingCard finding={item} repositoryId="r1" onOpenFinding={vi.fn()} />
)

describe('finding AI (B5)', () => {
  it('says what is sent, and to whom, before anything is sent', async () => {
    renderWithProviders(card())

    expect(await screen.findByText(/Sends this finding and up to 11 lines around line 30 of app\/main\.py to Groq \(test-model\)/)).toBeInTheDocument()
    expect(mockedApi.findingAi).not.toHaveBeenCalled()
  })

  it('explains a finding on request and renders the answer as Markdown', async () => {
    mockedApi.findingAi.mockResolvedValue(answer('F1', 'explain', 'This is **serious**.'))
    const user = userEvent.setup()
    renderWithProviders(card())

    await user.click(await screen.findByRole('button', { name: 'Explain finding' }))

    expect(mockedApi.findingAi).toHaveBeenCalledWith('r1', 'F1', 'explain')
    const region = await screen.findByRole('region', { name: 'AI explanation' })
    expect(within(region).getByText('serious').tagName).toBe('STRONG')
    expect(within(region).getByText(/Sent: app\/main\.py, lines 20–40/)).toBeInTheDocument()
  })

  it('suggests a fix on request', async () => {
    mockedApi.findingAi.mockResolvedValue(answer('F1', 'fix', 'Read the key from the environment.'))
    const user = userEvent.setup()
    renderWithProviders(card())

    await user.click(await screen.findByRole('button', { name: 'Suggest fix' }))

    expect(mockedApi.findingAi).toHaveBeenCalledWith('r1', 'F1', 'fix')
    expect(await screen.findByRole('region', { name: 'Suggested fix' })).toHaveTextContent('Read the key from the environment.')
  })

  it('never renders raw HTML from the model', async () => {
    mockedApi.findingAi.mockResolvedValue(answer('F1', 'explain', '<img src=x onerror="alert(1)"> plain'))
    const user = userEvent.setup()
    const { container } = renderWithProviders(card())

    await user.click(await screen.findByRole('button', { name: 'Explain finding' }))
    await screen.findByRole('region', { name: 'AI explanation' })

    expect(container.querySelector('img')).toBeNull()
  })

  it('is disabled until AI is allowed for the repository', async () => {
    mockedApi.getAiConsent.mockResolvedValue(consent(false))
    renderWithProviders(card())

    expect(await screen.findByRole('button', { name: 'Explain finding' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Suggest fix' })).toBeDisabled()
    expect(screen.getByText(/Allow AI for this repository at the top of the page/)).toBeInTheDocument()
  })

  it('shows a clean error and does not retry', async () => {
    mockedApi.findingAi.mockRejectedValue(new ApiError('Groq is rate limiting requests. Try again in a minute.', 502))
    const user = userEvent.setup()
    renderWithProviders(card())

    await user.click(await screen.findByRole('button', { name: 'Explain finding' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Groq is rate limiting requests')
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(mockedApi.findingAi).toHaveBeenCalledTimes(1)
  })

  it('never shows one finding’s answer on another', async () => {
    let resolveSlow!: (value: unknown) => void
    mockedApi.findingAi.mockImplementation((_r: string, id: string, mode: 'explain') =>
      id === 'F1' ? new Promise((resolve) => { resolveSlow = resolve }) : Promise.resolve(answer(id, mode, `About ${id}`)),
    )
    const user = userEvent.setup()
    renderWithProviders(<>{card(finding('F1'))}{card(finding('F2'))}</>)

    const [first, second] = await screen.findAllByRole('button', { name: 'Explain finding' })
    await user.click(first)
    await user.click(second)
    await screen.findByText('About F2')
    await act(async () => resolveSlow(answer('F1', 'explain', 'About F1')))

    const cards = screen.getAllByRole('article')
    expect(await within(cards[0]).findByText('About F1')).toBeInTheDocument()
    expect(within(cards[1]).queryByText('About F1')).not.toBeInTheDocument()
  })

  it('without a reported line, says that no code is sent', async () => {
    renderWithProviders(card(finding('F3', null)))

    expect(await screen.findByText(/Sends this finding \(no code\) to Groq/)).toBeInTheDocument()
  })
})
