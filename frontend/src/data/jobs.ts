import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { api } from '../services/api'
import type { Job, JobKind } from '../types'

export const jobKeys = {
  active: ['jobs', 'active'] as const,
}

/** How often active jobs are polled (fast under test). */
export const jobPolling = { intervalMs: import.meta.env.MODE === 'test' ? 20 : 1000 }

/**
 * Every queued or running job (B3). Polled while any is active, and read on
 * load, so progress survives a page refresh.
 */
export function useActiveJobs() {
  const client = useQueryClient()
  // Decided on every render (not once by a callback), so polling starts as
  // soon as a started job is added to the cache.
  const known = client.getQueryData<Job[]>(jobKeys.active)
  return useQuery({
    queryKey: jobKeys.active,
    queryFn: ({ signal }) => api.listActiveJobs(signal),
    refetchInterval: known?.length ? jobPolling.intervalMs : false,
    staleTime: 0,
  })
}

/** The active job of a kind for a repository, if any. */
export function useActiveJob(kind: JobKind, repoId: string | null): Job | null {
  const jobs = useActiveJobs().data ?? []
  return jobs.find((job) => job.kind === kind && job.repository_id === repoId) ?? null
}

function track(client: QueryClient, job: Job) {
  client.setQueryData<Job[]>(jobKeys.active, (current = []) =>
    current.some((item) => item.id === job.id) ? current : [...current, job],
  )
}

/** Start a job and add it to the active list at once (the watcher takes it from there). */
export function useStartJob<Input>(start: (input: Input) => Promise<Job>) {
  const client = useQueryClient()
  return useMutation({
    // Only the input: TanStack passes a second (context) argument to mutationFn.
    mutationFn: (input: Input) => start(input),
    onSuccess: (job) => track(client, job),
  })
}

export function useCancelJob() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => api.cancelJob(jobId),
    onSuccess: (job) =>
      client.setQueryData<Job[]>(jobKeys.active, (current = []) =>
        current.map((item) => (item.id === job.id ? job : item)),
      ),
  })
}

/**
 * Calls `onFinished` once for every job that leaves the active list, with
 * its final state. Mounted once, in the shell.
 */
export function useJobWatcher(onFinished: (job: Job) => void) {
  const jobs = useActiveJobs().data
  const seen = useRef(new Set<string>())
  const handler = useRef(onFinished)
  useEffect(() => {
    handler.current = onFinished
  })

  useEffect(() => {
    if (!jobs) return
    const active = new Set(jobs.map((job) => job.id))
    for (const id of seen.current) {
      if (active.has(id)) continue
      seen.current.delete(id)
      api.getJob(id).then(
        (job) => handler.current(job),
        () => undefined,
      )
    }
    for (const id of active) seen.current.add(id)
  }, [jobs])
}
