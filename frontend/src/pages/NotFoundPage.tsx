import type { ReactNode } from 'react'
import { FileQuestion, FolderX } from 'lucide-react'
import { Link } from 'react-router'

import { buttonClasses } from '../components/ui/buttonClasses'
import { Card, EmptyState } from '../components/ui'
import { paths } from '../app/paths'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Card>{children}</Card>
    </div>
  )
}

/** Any address the application does not know. */
export function NotFoundPage() {
  useDocumentTitle('Page not found')
  return (
    <Frame>
      <EmptyState
        headingLevel={1}
        icon={<FileQuestion size={24} />}
        title="Page not found"
        description="This address does not match any page in CodeLens AI."
        action={
          <Link to={paths.home} className={buttonClasses('primary')}>
            Go to your repositories
          </Link>
        }
      />
    </Frame>
  )
}

/** A /repo/:id address whose repository does not exist (deleted, or a stale link). */
export function RepositoryNotFoundPage({ repoId }: { repoId: string }) {
  useDocumentTitle('Repository not found')
  return (
    <Frame>
      <EmptyState
        headingLevel={1}
        icon={<FolderX size={24} />}
        title="Repository not found"
        description={
          <>
            No imported repository has the id <code className="font-mono break-all">{repoId}</code>.
            It may have been deleted.
          </>
        }
        action={
          <Link to={paths.home} className={buttonClasses('primary')}>
            Back to your repositories
          </Link>
        }
      />
    </Frame>
  )
}
