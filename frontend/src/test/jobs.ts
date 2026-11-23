import { vi } from 'vitest'

import type { Job, JobKind } from '../types'

type MockedApi = Record<string, ReturnType<typeof vi.fn>>

/**
 * An in-memory stand-in for /api/jobs: start, poll, cancel. Tests move jobs
 * along with `progress`, `finish` and `fail`.
 */
export function fakeJobServer(api: MockedApi) {
  const jobs = new Map<string, Job>()
  let counter = 0

  const create = (kind: JobKind, repositoryId: string | null, message = 'Waiting to start'): Job => {
    const existing = [...jobs.values()].find(
      (job) => repositoryId !== null && job.kind === kind && job.repository_id === repositoryId && isActive(job),
    )
    if (existing) return existing
    const job: Job = {
      id: `job-${++counter}`, kind, repository_id: repositoryId, status: 'queued', progress: null,
      message, result: null, error: null, created_at: '', updated_at: '',
    }
    jobs.set(job.id, job)
    return { ...job }
  }
  const isActive = (job: Job) => job.status === 'queued' || job.status === 'running'
  const update = (id: string, patch: Partial<Job>) => {
    const job = jobs.get(id)
    if (!job) throw new Error(`no job ${id}`)
    jobs.set(id, { ...job, ...patch })
  }

  api.listActiveJobs = vi.fn(async () => [...jobs.values()].filter(isActive).map((job) => ({ ...job })))
  api.getJob = vi.fn(async (id: string) => ({ ...jobs.get(id)! }))
  api.cancelJob = vi.fn(async (id: string) => {
    update(id, { status: 'cancelled', message: 'Cancelled' })
    return { ...jobs.get(id)! }
  })
  api.startAnalysisJob = vi.fn(async (repoId: string) => create('analysis', repoId))
  api.startDependenciesJob = vi.fn(async (repoId: string) => create('dependencies', repoId))
  api.startLinkImportJob = vi.fn(async (url: string) => create('import', null, `Cloning ${url}`))
  api.startZipImportJob = vi.fn(async () => create('import', null, 'Extracting the archive'))

  return {
    jobs,
    /** The most recently started job of a kind. */
    latest: (kind: JobKind) => [...jobs.values()].filter((job) => job.kind === kind).at(-1)!,
    add: (job: Partial<Job> & Pick<Job, 'kind'>) => {
      const created = create(job.kind, job.repository_id ?? null)
      update(created.id, job)
      return jobs.get(created.id)!
    },
    progress: (id: string, progress: number | null, message: string) => update(id, { status: 'running', progress, message }),
    finish: (id: string, result: unknown, repositoryId?: string) =>
      update(id, { status: 'succeeded', progress: 1, message: 'Done', result, ...(repositoryId ? { repository_id: repositoryId } : {}) }),
    fail: (id: string, error: string) => update(id, { status: 'failed', message: 'Failed', error }),
  }
}
