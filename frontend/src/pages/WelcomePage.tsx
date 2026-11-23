import { FolderGit2 } from 'lucide-react'

import ImportPanel from '../components/import/ImportPanel'
import { Card, EmptyState } from '../components/ui'

export default function WelcomePage({
  importing,
  onImportLink,
  onImportZip,
}: {
  importing: boolean
  onImportLink: (url: string) => Promise<boolean | void>
  onImportZip: (file: File) => Promise<boolean | void>
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Card>
        <EmptyState
          headingLevel={1}
          icon={<FolderGit2 size={24} />}
          title="Welcome to CodeLens AI"
          description="Import a repository to explore its structure, check it with static analyzers and understand it with AI."
        />
        <div className="px-4 pb-6 sm:px-6">
          <ImportPanel importing={importing} onImportLink={onImportLink} onImportZip={onImportZip} />
        </div>
      </Card>
    </div>
  )
}
