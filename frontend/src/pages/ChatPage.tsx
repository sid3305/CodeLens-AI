import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Bot, FileCode2, MessagesSquare, SendHorizontal, Trash2, User } from 'lucide-react'

import AiConsentNotice from '../components/ai/AiConsent'
import MarkdownContent from '../components/layout/MarkdownContent'
import { Button, EmptyState, InlineMessage, LoadingBlock, cn } from '../components/ui'
import { useAiAllowed, useAskChat, useChat, useClearChat } from '../data/hooks'
import { errorMessage } from '../services/api'
import type { ChatMessage, Repository } from '../types'
import { PageContainer, PageHeader } from './PageHeader'

const MAX_QUESTION = 1000

const SUGGESTIONS = [
  'What does this project do, and where should I start reading?',
  'How is the code organised into modules?',
  'Which findings should I fix first, and why?',
  'Where are requests handled, and what do they call?',
]

function MessageBubble({
  message,
  onOpenFile,
}: {
  message: ChatMessage
  onOpenFile: (path: string, line: number | null) => void
}) {
  const mine = message.role === 'user'
  return (
    <li className={cn('flex gap-3', mine && 'flex-row-reverse')}>
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
          mine ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-muted',
        )}
      >
        {mine ? <User size={16} /> : <Bot size={16} />}
      </span>
      <div
        className={cn(
          'min-w-0 max-w-[85%] rounded-md border px-3.5 py-2.5 text-base',
          mine ? 'border-transparent bg-accent-soft text-fg' : 'border-border bg-surface text-fg',
        )}
      >
        <span className="sr-only">{mine ? 'You said:' : 'CodeLens answered:'}</span>
        {mine ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <MarkdownContent content={message.content} />
        )}
        {!mine && message.sources.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <p className="text-xs font-medium text-fg-muted">Code sent with the question</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {message.sources.map((source) => (
                <li key={`${source.file}:${source.start_line}`}>
                  <button
                    type="button"
                    onClick={() => onOpenFile(source.file, source.start_line)}
                    className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <FileCode2 size={12} aria-hidden="true" />
                    {source.file}:{source.start_line}–{source.end_line}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!mine && (message.input_tokens || message.cached) && (
          <p className="mt-1.5 text-xs text-fg-subtle">
            {message.cached ? 'Saved answer, no tokens used' : `About ${message.input_tokens?.toLocaleString()} input tokens`}
          </p>
        )}
      </div>
    </li>
  )
}

export default function ChatPage({
  repository,
  onOpenFile,
}: {
  repository: Repository
  onOpenFile: (path: string, line: number | null) => void
}) {
  const chat = useChat(repository.id)
  const ask = useAskChat(repository.id)
  const clear = useClearChat(repository.id)
  const allowed = useAiAllowed(repository.id)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const endRef = useRef<HTMLLIElement>(null)
  const messages = chat.data ?? []

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, pending])

  const send = (question: string) => {
    const text = question.trim()
    if (!text || ask.isPending || !allowed) return
    setPending(text)
    setDraft('')
    ask.mutate(text, {
      onError: () => setDraft(text),
      onSettled: () => setPending(null),
    })
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    send(draft)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send(draft)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Ask AI"
        description="Ask questions about this repository. Answers use its facts and the code related to your question."
        actions={
          messages.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} aria-hidden="true" />}
              loading={clear.isPending}
              disabled={ask.isPending}
              onClick={() => clear.mutate()}
            >
              Clear chat
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <AiConsentNotice
          repoId={repository.id}
          sends="your question, the last few messages, a short fact sheet and up to 3 related code excerpts (about 40 lines each)"
        />
      </div>

      <section aria-label="Conversation" className="rounded-md border border-border bg-surface-2/40">
        {chat.isPending ? (
          <div className="p-4">
            <LoadingBlock label="Loading the conversation" lines={3} />
          </div>
        ) : messages.length === 0 && !pending ? (
          <EmptyState
            icon={<MessagesSquare size={20} />}
            title="Ask anything about this repository"
            description="For example:"
            action={SUGGESTIONS.map((suggestion) => (
              <Button key={suggestion} size="sm" disabled={!allowed} onClick={() => send(suggestion)}>
                {suggestion}
              </Button>
            ))}
          />
        ) : (
          <ol aria-live="polite" aria-relevant="additions" className="max-h-[60vh] space-y-4 overflow-y-auto p-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} onOpenFile={onOpenFile} />
            ))}
            {pending && (
              <>
                <MessageBubble
                  message={{ id: 'pending', role: 'user', content: pending, created_at: '', sources: [], input_tokens: null, cached: false }}
                  onOpenFile={onOpenFile}
                />
                <li className="flex items-center gap-3 text-sm text-fg-muted" role="status">
                  <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-surface-2">
                    <Bot size={16} />
                  </span>
                  Reading the code and thinking…
                </li>
              </>
            )}
            <li ref={endRef} aria-hidden="true" />
          </ol>
        )}
      </section>

      {chat.error && (
        <InlineMessage tone="error" className="mt-2">
          {errorMessage(chat.error, 'Unable to load the conversation.')}
        </InlineMessage>
      )}
      {ask.error && (
        <InlineMessage tone="error" className="mt-2">
          {errorMessage(ask.error, 'The question could not be answered.')}
        </InlineMessage>
      )}

      <form onSubmit={onSubmit} className="mt-3 flex items-end gap-2">
        <label htmlFor="chat-question" className="sr-only">
          Your question
        </label>
        <textarea
          id="chat-question"
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, MAX_QUESTION))}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={MAX_QUESTION}
          disabled={!allowed}
          placeholder={allowed ? 'Ask about the code… (Enter to send, Shift+Enter for a new line)' : 'Allow AI for this repository to start chatting'}
          className="min-h-[2.75rem] flex-1 resize-y rounded-sm border border-border-strong bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <Button
          type="submit"
          variant="primary"
          icon={<SendHorizontal size={15} aria-hidden="true" />}
          loading={ask.isPending}
          disabled={!allowed || !draft.trim()}
        >
          Send
        </Button>
      </form>
      <p className="mt-1 text-right text-xs text-fg-subtle">
        {draft.length}/{MAX_QUESTION}
      </p>
    </PageContainer>
  )
}
