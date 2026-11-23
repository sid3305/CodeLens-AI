import { useEffect, useId, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import { Link2, Upload } from 'lucide-react'

import { api, errorMessage } from '../../services/api'
import type { RepositoryLinkPreview } from '../../types'
import { Button, InlineMessage, buttonClasses, cn } from '../ui'

const VALIDATE_DELAY_MS = 300

interface ImportPanelProps {
  /** Return false when the import failed so the typed link is kept. */
  onImportLink: (url: string) => Promise<boolean | void>
  onImportZip: (file: File) => Promise<boolean | void>
  importing: boolean
  compact?: boolean
}

/** Validation result, tagged with the exact text it belongs to. */
interface Validation {
  text: string
  preview: RepositoryLinkPreview | null
  error: string | null
}

function isZip(file: File) {
  return file.name.toLowerCase().endsWith('.zip')
}

/**
 * One place to import a repository: paste any normal repository link
 * (validated and normalised by the server before anything is cloned) or
 * pick/drop a ZIP archive.
 */
export default function ImportPanel({
  onImportLink,
  onImportZip,
  importing,
  compact = false,
}: ImportPanelProps) {
  const inputId = useId()
  const statusId = useId()
  const zipId = useId()

  const [link, setLink] = useState('')
  const [validation, setValidation] = useState<Validation | null>(null)
  const [dropError, setDropError] = useState<string | null>(null)

  const text = link.trim()

  useEffect(() => {
    if (!text) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api.parseRepositoryLink(text, controller.signal).then(
        (preview) => {
          if (!controller.signal.aborted) setValidation({ text, preview, error: null })
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setValidation({ text, preview: null, error: errorMessage(error, 'This link cannot be imported.') })
          }
        },
      )
    }, VALIDATE_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [text])

  // Only a result for the text currently in the box is ever shown.
  const current = validation && validation.text === text ? validation : null
  const checking = Boolean(text) && current === null
  const preview = current?.preview ?? null
  const linkError = current?.error ?? null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!preview || importing) return
    const ok = await onImportLink(text)
    if (ok !== false) setLink('')
  }

  const importZip = async (file: File) => {
    if (!isZip(file)) {
      setDropError(`Drop a .zip file to import it (${file.name} is not a ZIP archive).`)
      return
    }
    setDropError(null)
    await onImportZip(file)
  }

  const onZipChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await importZip(file)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer?.files?.[0]
    if (file) void importZip(file)
  }

  return (
    <div
      role="group"
      aria-label="Import a repository"
      className={cn('grid w-full gap-3 text-left', !compact && 'mx-auto max-w-xl')}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <form className="grid gap-1.5" onSubmit={submit} noValidate>
        <label htmlFor={inputId} className="inline-flex items-center gap-1.5 text-sm font-medium text-fg">
          <Link2 size={14} aria-hidden="true" />
          Repository link
        </label>
        <div className={cn('flex gap-2', compact && 'flex-col')}>
          <input
            id={inputId}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder={compact ? 'owner/repo or GitHub link' : 'https://github.com/owner/repository or owner/repo'}
            aria-invalid={linkError ? true : undefined}
            aria-describedby={statusId}
            disabled={importing}
            className={cn(
              'h-9 min-w-0 flex-1 rounded-sm border bg-surface px-2.5 text-base text-fg placeholder:text-fg-subtle',
              linkError ? 'border-danger' : 'border-border-strong',
            )}
          />
          <Button type="submit" variant="primary" disabled={!preview} loading={importing}>
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </div>
        <p
          id={statusId}
          className={cn('text-sm break-words', linkError ? 'text-danger' : preview ? 'font-medium text-fg' : 'text-fg-muted')}
          aria-live="polite"
        >
          {checking
            ? 'Checking link…'
            : preview
              ? `Will import ${preview.display}`
              : linkError ?? 'Any public GitHub repository, branch, folder or commit link.'}
        </p>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        <span>or</span>
        <input
          id={zipId}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="peer sr-only"
          onChange={(event) => void onZipChosen(event)}
          disabled={importing}
        />
        <label
          htmlFor={zipId}
          className={cn(
            buttonClasses('secondary', 'sm'),
            'cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
          )}
        >
          <Upload size={14} aria-hidden="true" />
          Choose ZIP archive
        </label>
        {!compact && <span>or drag an archive onto this panel.</span>}
      </div>

      {dropError && <InlineMessage tone="error">{dropError}</InlineMessage>}
    </div>
  )
}
