import { useEffect, useId, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import { Link2, Upload } from 'lucide-react'

import { api, errorMessage } from '../../services/api'
import type { RepositoryLinkPreview } from '../../types'

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
      className={`import-panel${compact ? ' compact' : ''}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <form className="import-link-form" onSubmit={submit} noValidate>
        <label htmlFor={inputId} className="import-label">
          <Link2 size={15} aria-hidden="true" />
          Repository link
        </label>
        <div className="import-link-row">
          <input
            id={inputId}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://github.com/owner/repository or owner/repo"
            aria-invalid={linkError ? true : undefined}
            aria-describedby={statusId}
            disabled={importing}
          />
          <button type="submit" className="primary-button" disabled={!preview || importing}>
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
        <p
          id={statusId}
          className={`import-status${linkError ? ' error' : ''}`}
          aria-live="polite"
        >
          {checking
            ? 'Checking link…'
            : preview
              ? `Will import ${preview.display}`
              : linkError ?? 'Public GitHub repositories: any repository, branch, folder or commit link.'}
        </p>
      </form>

      <div className="import-zip-row">
        <span className="import-or">or</span>
        <input
          id={zipId}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="sr-only"
          onChange={(event) => void onZipChosen(event)}
          disabled={importing}
        />
        <label htmlFor={zipId} className="secondary-button">
          <Upload size={15} aria-hidden="true" />
          Choose ZIP archive
        </label>
        <span className="import-hint">You can also drag an archive onto this panel.</span>
      </div>

      {dropError && (
        <p className="inline-error" role="alert">{dropError}</p>
      )}
    </div>
  )
}
