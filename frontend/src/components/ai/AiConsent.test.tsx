import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AiConsentNotice from './AiConsent'
import { api } from '../../services/api'
import { renderWithProviders } from '../../test/render'

vi.mock('../../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/api')>()
  return { ...original, api: { getAiConsent: vi.fn(), setAiConsent: vi.fn() } }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const consent = (overrides = {}) => ({
  repository_id: 'r1', enabled: false, provider: 'Groq', model: 'openai/gpt-oss-120b', configured: true, problem: null, ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.getAiConsent.mockResolvedValue(consent())
  mockedApi.setAiConsent.mockImplementation(async (_id: string, enabled: boolean) => consent({ enabled }))
})

describe('AI consent notice (B6)', () => {
  it('is off by default and says what would be sent, and to whom', async () => {
    renderWithProviders(<AiConsentNotice repoId="r1" sends="this file" />)

    expect(await screen.findByText(/AI is off for this repository/)).toBeInTheDocument()
    const note = screen.getByText(/Allowing it lets CodeLens send this file to Groq \(openai\/gpt-oss-120b\)/)
    expect(note).toHaveTextContent(/secrets are redacted/i)
    expect(mockedApi.setAiConsent).not.toHaveBeenCalled()
  })

  it('turns on only on an explicit click, and can be turned off again', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AiConsentNotice repoId="r1" sends="this file" />)

    await user.click(await screen.findByRole('button', { name: 'Allow AI for this repository' }))
    expect(mockedApi.setAiConsent).toHaveBeenCalledWith('r1', true)
    await screen.findByText(/AI is on/)
    expect(screen.getByRole('note')).toHaveTextContent('AI is on. Sends this file to Groq (openai/gpt-oss-120b).')

    await user.click(screen.getByRole('button', { name: 'Turn off AI for this repository' }))
    expect(mockedApi.setAiConsent).toHaveBeenLastCalledWith('r1', false)
    await waitFor(() => expect(screen.getByText(/AI is off for this repository/)).toBeInTheDocument())
  })

  it('explains how to set up AI when the provider is not configured', async () => {
    mockedApi.getAiConsent.mockResolvedValue(consent({ configured: false }))
    renderWithProviders(<AiConsentNotice repoId="r1" sends="this file" />)

    expect(await screen.findByText(/AI is not set up/)).toHaveTextContent('GROQ_API_KEY')
  })

  it('shows a configuration problem as reported by the backend', async () => {
    mockedApi.getAiConsent.mockResolvedValue(consent({ provider: 'none', configured: false, problem: "Unknown AI provider 'x'." }))
    renderWithProviders(<AiConsentNotice repoId="r1" sends="this file" />)

    expect(await screen.findByText("Unknown AI provider 'x'.")).toBeInTheDocument()
  })

  it('names a local provider as local', async () => {
    mockedApi.getAiConsent.mockResolvedValue(consent({ provider: 'Ollama', model: 'llama3.1', enabled: true }))
    renderWithProviders(<AiConsentNotice repoId="r1" sends="this file" />)

    await screen.findByText(/AI is on/)
    expect(screen.getByRole('note')).toHaveTextContent('Sends this file to Ollama (llama3.1) on this machine.')
  })
})
