import { Lightbulb, Sparkles, Wrench } from 'lucide-react'

import { useAiConsent, useFindingAi, useFindingEstimates, useStoredFindingAi } from '../../data/hooks'
import { errorMessage } from '../../services/api'
import type { Finding, FindingAiMode, FindingAiResponse } from '../../types'
import MarkdownContent from '../layout/MarkdownContent'
import { Button, InlineMessage } from '../ui'

const TITLES: Record<FindingAiMode, string> = { explain: 'AI explanation', fix: 'Suggested fix' }

function Answer({ answer }: { answer: FindingAiResponse }) {
  const id = `finding-ai-${answer.finding_id}-${answer.mode}`
  const { file, start_line: start, end_line: end } = answer.sent
  return (
    <section aria-labelledby={id} className="rounded-sm border border-border bg-surface-2 px-3 py-2.5">
      <h4 id={id} className="flex items-center gap-1.5 text-sm font-semibold text-fg">
        {answer.mode === 'fix' ? <Wrench size={14} aria-hidden="true" /> : <Lightbulb size={14} aria-hidden="true" />}
        {TITLES[answer.mode]}
      </h4>
      <div className="prose-content mt-1.5 text-sm">
        <MarkdownContent content={answer.text} />
      </div>
      <p className="mt-2 text-xs text-fg-subtle">
        Sent: {file}
        {start !== null && end !== null ? `, lines ${start}–${end}` : ' (no code)'} · AI output can be wrong; check it.
      </p>
    </section>
  )
}

/**
 * B5: "Explain finding" and "Suggest fix". Only an explicit click sends
 * anything; the note says exactly what and to whom. Consent is given once
 * at the top of the Issues page.
 */
export default function FindingAi({ finding, repositoryId }: { finding: Finding; repositoryId: string }) {
  const consent = useAiConsent(repositoryId).data
  const estimates = useFindingEstimates(repositoryId).data
  const tokens = estimates?.findings[finding.id]
  const ask = useFindingAi(repositoryId, finding.id)
  const explained = useStoredFindingAi(repositoryId, finding.id, 'explain').data
  const fixed = useStoredFindingAi(repositoryId, finding.id, 'fix').data

  const allowed = Boolean(consent?.enabled && consent.configured)
  const busy = ask.isPending ? ask.variables : null
  const recipient = consent ? `${consent.provider} (${consent.model})` : 'the AI provider'
  const payload = finding.line
    ? `this finding and up to 21 lines around line ${finding.line} of ${finding.file}`
    : 'this finding (no code)'

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={<Sparkles size={14} aria-hidden="true" />}
          disabled={!allowed || ask.isPending}
          loading={busy === 'explain'}
          onClick={() => ask.mutate('explain')}
        >
          Explain finding
        </Button>
        <Button
          size="sm"
          icon={<Wrench size={14} aria-hidden="true" />}
          disabled={!allowed || ask.isPending}
          loading={busy === 'fix'}
          onClick={() => ask.mutate('fix')}
        >
          Suggest fix
        </Button>
      </div>
      <p className="text-xs text-fg-subtle">
        {allowed
          ? `Sends ${payload}${tokens ? ` (about ${tokens.toLocaleString()} input tokens, up to ${estimates!.output_tokens.toLocaleString()} output tokens)` : ''} to ${recipient}. Secrets are redacted; code from sensitive files is never sent.`
          : 'AI is off for this repository. Allow AI for this repository at the top of the page to use these.'}
      </p>
      {ask.error && <InlineMessage tone="error">{errorMessage(ask.error, 'The AI request failed.')}</InlineMessage>}
      {explained && <Answer answer={explained} />}
      {fixed && <Answer answer={fixed} />}
    </div>
  )
}
