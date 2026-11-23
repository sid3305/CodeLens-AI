import { useId, useState } from 'react'
import { Download } from 'lucide-react'

import { api, errorMessage } from '../../services/api'
import { Button, InlineMessage } from '../ui'

type Format = 'html' | 'json' | 'sarif'

const FORMATS: { format: Format; label: string; hint: string }[] = [
  { format: 'html', label: 'HTML report', hint: 'One file that opens offline in any browser' },
  { format: 'json', label: 'JSON', hint: 'All report data' },
  { format: 'sarif', label: 'SARIF', hint: 'Findings for code-scanning tools' },
]

/** X3: download the report. Lazy-loaded; exporting never calls the AI. */
export default function ExportPanel({ repoId, hasSummary }: { repoId: string; hasSummary: boolean }) {
  const checkboxId = useId()
  const [includeSummary, setIncludeSummary] = useState(false)
  const [busy, setBusy] = useState<Format | null>(null)
  const [error, setError] = useState<string | null>(null)

  const download = async (format: Format) => {
    setBusy(format)
    setError(null)
    try {
      const { blob, filename } = await api.exportReport(repoId, format, includeSummary && hasSummary)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(errorMessage(err, 'Export failed.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-5 space-y-3 rounded-md border border-border bg-surface p-4" role="region" aria-label="Export report">
      <p className="text-sm text-fg-muted">
        Repository-relative paths only; secrets in code snippets are redacted and sensitive files are left out.
      </p>
      <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm">
        <input
          id={checkboxId}
          type="checkbox"
          checked={includeSummary && hasSummary}
          disabled={!hasSummary}
          onChange={(event) => setIncludeSummary(event.target.checked)}
        />
        Include AI summary {!hasSummary && <span className="text-fg-subtle">(none generated yet)</span>}
      </label>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map(({ format, label, hint }) => (
          <Button
            key={format}
            size="sm"
            icon={<Download size={14} aria-hidden="true" />}
            loading={busy === format}
            disabled={busy !== null}
            title={hint}
            onClick={() => void download(format)}
          >
            {label}
          </Button>
        ))}
      </div>
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
    </div>
  )
}
