import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ChatPage from './ChatPage'
import { ApiError, api } from '../services/api'
import { renderWithProviders } from '../test/render'
import type { ChatMessage, Repository } from '../types'

vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/api')>()
  return {
    ...original,
    api: { getAiConsent: vi.fn(), setAiConsent: vi.fn(), getChat: vi.fn(), askChat: vi.fn(), clearChat: vi.fn() },
  }
})

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>
const repository = { id: 'r1', name: 'demo' } as Repository

const consent = (enabled: boolean, keys = 3) => ({
  repository_id: 'r1', enabled, provider: 'Groq', model: 'test-model', configured: true, problem: null, keys,
})

const message = (id: string, role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role, content, created_at: '', sources: [], input_tokens: null, cached: false, ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.getAiConsent.mockResolvedValue(consent(true))
  mockedApi.getChat.mockResolvedValue({ repository_id: 'r1', messages: [] })
})

describe('repository chat', () => {
  it('says what is sent and to whom, including the key pool', async () => {
    renderWithProviders(<ChatPage repository={repository} onOpenFile={vi.fn()} />)

    expect(await screen.findByText(/to Groq \(test-model, 3 keys in rotation\)/)).toBeInTheDocument()
    expect(mockedApi.askChat).not.toHaveBeenCalled()
  })

  it('sends a question and shows the answer with its code sources', async () => {
    const onOpenFile = vi.fn()
    mockedApi.askChat.mockResolvedValue({
      repository_id: 'r1',
      question: message('q1', 'user', 'Where is login?'),
      answer: message('a1', 'assistant', 'In **auth.py**.', {
        sources: [{ file: 'app/auth.py', start_line: 10, end_line: 49 }], input_tokens: 812,
      }),
    })
    renderWithProviders(<ChatPage repository={repository} onOpenFile={onOpenFile} />)

    await screen.findByText('AI is on.')
    const box = screen.getByRole('textbox', { name: 'Your question' })
    await userEvent.type(box, 'Where is login?{Enter}')

    expect(mockedApi.askChat).toHaveBeenCalledWith('r1', 'Where is login?')
    expect(await screen.findByText('auth.py')).toBeInTheDocument()
    expect(screen.getByText(/About 812 input tokens/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /app\/auth\.py:10/ }))
    expect(onOpenFile).toHaveBeenCalledWith('app/auth.py', 10)
  })

  it('keeps the question when asking fails', async () => {
    mockedApi.askChat.mockRejectedValue(new ApiError('All 3 Groq key(s) reached their per-minute limit.', 502))
    renderWithProviders(<ChatPage repository={repository} onOpenFile={vi.fn()} />)

    await screen.findByText('AI is on.')
    const box = screen.getByRole('textbox', { name: 'Your question' })
    await userEvent.type(box, 'Explain billing{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('per-minute limit')
    expect(box).toHaveValue('Explain billing')
    expect(mockedApi.askChat).toHaveBeenCalledTimes(1)
  })

  it('cannot send until AI is allowed for the repository', async () => {
    mockedApi.getAiConsent.mockResolvedValue(consent(false))
    renderWithProviders(<ChatPage repository={repository} onOpenFile={vi.fn()} />)

    expect(await screen.findByText('AI is off for this repository.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeDisabled()
  })

  it('shows the saved conversation and clears it', async () => {
    mockedApi.getChat.mockResolvedValue({
      repository_id: 'r1',
      messages: [message('q1', 'user', 'Hi'), message('a1', 'assistant', 'Hello there.', { cached: true })],
    })
    mockedApi.clearChat.mockResolvedValue({ repository_id: 'r1', messages: [] })
    renderWithProviders(<ChatPage repository={repository} onOpenFile={vi.fn()} />)

    expect(await screen.findByText('Hello there.')).toBeInTheDocument()
    expect(screen.getByText('Saved answer, no tokens used')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear chat' }))
    expect(await screen.findByText('Ask anything about this repository')).toBeInTheDocument()
  })
})
