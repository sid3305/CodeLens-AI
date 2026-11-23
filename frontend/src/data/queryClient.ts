import { QueryClient } from '@tanstack/react-query'

import { ApiError } from '../services/api'

/**
 * Every key starts with the repository id it belongs to, so data from one
 * repository can never be read under another.
 */
export const queryKeys = {
  health: ['health'] as const,
  repositories: ['repositories'] as const,
  files: (repoId: string) => ['repository', repoId, 'files'] as const,
  analysis: (repoId: string) => ['repository', repoId, 'analysis'] as const,
  summary: (repoId: string) => ['repository', repoId, 'summary'] as const,
  aiConsent: (repoId: string) => ['repository', repoId, 'ai-consent'] as const,
  dependencies: (repoId: string) => ['repository', repoId, 'dependencies'] as const,
  fileContent: (repoId: string, path: string) => ['repository', repoId, 'file', path] as const,
  explanation: (repoId: string, path: string) => ['repository', repoId, 'explanation', path] as const,
}

const MAX_RETRIES = 2

/** GETs are idempotent: retry server/network errors, never client errors. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false
  if (error instanceof DOMException && error.name === 'AbortError') return false
  return failureCount < MAX_RETRIES
}

/** 0.5 s, 1 s, 2 s ... capped at 8 s. */
export function retryDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8000)
}

export function createQueryClient(options: { retryDelay?: number } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: options.retryDelay ?? retryDelay,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      // Mutations (imports, analysis, and every LLM call) are never retried
      // automatically: they are not idempotent, and LLM calls cost money.
      mutations: { retry: false },
    },
  })
}
