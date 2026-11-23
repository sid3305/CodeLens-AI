import { ShieldCheck, ShieldOff } from 'lucide-react'

import { useAiConsent, useAiEstimate, useSetAiConsent } from '../../data/hooks'
import type { AiEstimateQuery } from '../../types'
import { errorMessage } from '../../services/api'
import { Button, InlineMessage } from '../ui'

const recipient = (provider: string, model: string) =>
  `${provider} (${model})${provider === 'Ollama' ? ' on this machine' : ''}`

/**
 * The visible note next to every AI action (B6): AI is off per repository
 * until the user allows it, and the note always says what is sent and to
 * which provider. `sends` describes the payload, e.g. "this file".
 */
export default function AiConsentNotice({
  repoId,
  sends,
  estimate: estimateQuery = null,
}: {
  repoId: string
  sends: string
  /** The task to count, so the note can say how many tokens it sends. */
  estimate?: AiEstimateQuery | null
}) {
  const consent = useAiConsent(repoId)
  const estimate = useAiEstimate(repoId, estimateQuery).data
  const size = estimate
    ? ` (about ${estimate.input_tokens.toLocaleString()} input tokens, up to ${estimate.output_tokens.toLocaleString()} output tokens)`
    : ''
  const overBudget = estimate && !estimate.within_budget
    ? ` That is over the limit of ${estimate.max_input_tokens.toLocaleString()} input tokens (CODELENS_LLM_MAX_INPUT_TOKENS).`
    : ''
  const update = useSetAiConsent(repoId)
  const data = consent.data

  if (consent.error) {
    return <InlineMessage tone="error">{errorMessage(consent.error, 'Unable to read the AI setting.')}</InlineMessage>
  }
  if (!data) return null

  if (!data.configured) {
    return (
      <p className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted" role="note">
        {data.problem ?? `AI is not set up: add GROQ_API_KEY to .env and restart the backend.`}
      </p>
    )
  }

  const to = recipient(data.provider, data.model)

  if (!data.enabled) {
    return (
      <div className="space-y-2 rounded-sm border border-border bg-surface-2 px-3 py-2.5 text-sm" role="note">
        <p className="flex items-center gap-1.5 font-medium text-fg">
          <ShieldOff size={15} aria-hidden="true" />
          AI is off for this repository.
        </p>
        <p className="text-fg-muted">
          Allowing it lets CodeLens send {sends}{size} to {to} when you ask.{overBudget} Secrets are redacted and
          sensitive files (.env, keys, credentials) are never sent.
        </p>
        <Button size="sm" loading={update.isPending} onClick={() => update.mutate(true)}>
          Allow AI for this repository
        </Button>
        {update.error && <InlineMessage tone="error">{errorMessage(update.error, 'Could not change the AI setting.')}</InlineMessage>}
      </div>
    )
  }

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted" role="note">
      <ShieldCheck size={15} aria-hidden="true" className="text-success" />
      <span>
        <span className="font-medium text-fg">AI is on.</span> Sends {sends}{size} to {to}.{overBudget}
      </span>
      <button
        type="button"
        onClick={() => update.mutate(false)}
        disabled={update.isPending}
        aria-label="Turn off AI for this repository"
        className="rounded-sm text-accent-text underline-offset-2 hover:underline"
      >
        Turn off
      </button>
    </p>
  )
}
