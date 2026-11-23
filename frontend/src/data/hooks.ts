import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../services/api'
import type {
  AiConsent,
  AiEstimateQuery,
  ExplainResponse,
  FindingAiMode,
  FindingAiResponse,
  Repository,
  SummaryResponse,
} from '../types'
import { queryKeys } from './queryClient'

const HEALTH_INTERVAL_MS = 30_000

// --- Reads ------------------------------------------------------------------

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.health(signal),
    refetchInterval: HEALTH_INTERVAL_MS,
    retry: false,
  })
}

export function useRepositories() {
  return useQuery({
    queryKey: queryKeys.repositories,
    queryFn: ({ signal }) => api.getRepositories(signal),
  })
}

export function useRepositoryFiles(repoId: string | null) {
  return useQuery({
    queryKey: queryKeys.files(repoId ?? ''),
    queryFn: ({ signal }) => api.getFiles(repoId!, signal),
    select: (response) => response.files,
    enabled: repoId !== null,
  })
}

/** Latest analysis, or null if none was run. */
export function useAnalysis(repoId: string | null) {
  return useQuery({
    queryKey: queryKeys.analysis(repoId ?? ''),
    queryFn: ({ signal }) => api.getAnalysisResults(repoId!, signal),
    enabled: repoId !== null,
  })
}

/** Saved AI summary, or null. Reading never calls the LLM. */
export function useSavedSummary(repoId: string) {
  return useQuery({
    queryKey: queryKeys.summary(repoId),
    queryFn: ({ signal }) => api.getSummary(repoId, signal),
  })
}

export function useFileContent(repoId: string, path: string | null) {
  return useQuery({
    queryKey: queryKeys.fileContent(repoId, path ?? ''),
    queryFn: ({ signal }) => api.getFileContent(repoId, path!, signal),
    select: (response) => response.content,
    enabled: path !== null,
  })
}

/**
 * The explanation stored for exactly this file (written by useExplainFile).
 * There is no fetch: explanations only exist after an explicit request.
 */
export function useStoredExplanation(repoId: string, path: string) {
  return useQuery<ExplainResponse | null>({
    queryKey: queryKeys.explanation(repoId, path),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  })
}

/**
 * The saved dependency report, or null if it was never computed. Computing
 * runs as a background job (B3); the job watcher refetches this when done.
 */
export function useDependencies(repoId: string) {
  return useQuery({
    queryKey: queryKeys.dependencies(repoId),
    queryFn: ({ signal }) => api.getCachedDependencies(repoId, signal),
  })
}

/** B6: AI consent for a repository and the provider that would receive code. */
export function useAiConsent(repoId: string) {
  return useQuery({
    queryKey: queryKeys.aiConsent(repoId),
    queryFn: ({ signal }) => api.getAiConsent(repoId, signal),
  })
}

/** Token counts of what a task would send; null query: nothing to estimate. */
export function useAiEstimate(repoId: string, query: AiEstimateQuery | null) {
  return useQuery({
    queryKey: ['repository', repoId, 'ai-estimate', query],
    queryFn: ({ signal }) => api.estimateAi(repoId, query!, signal),
    enabled: query !== null,
    retry: false,
  })
}

/** Input tokens per finding for the Issues page (one request). */
export function useFindingEstimates(repoId: string) {
  return useQuery({
    queryKey: ['repository', repoId, 'ai-estimate', 'findings'],
    queryFn: ({ signal }) => api.estimateFindings(repoId, signal),
    retry: false,
  })
}

/** True only when the user allowed AI here and the provider is set up. */
export function useAiAllowed(repoId: string): boolean {
  const consent = useAiConsent(repoId).data
  return Boolean(consent?.enabled && consent.configured)
}

// --- Writes -----------------------------------------------------------------

export function useSetAiConsent(repoId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => api.setAiConsent(repoId, enabled),
    onSuccess: (consent: AiConsent) => {
      client.setQueryData(queryKeys.aiConsent(repoId), consent)
      client.setQueryData<Repository[]>(queryKeys.repositories, (current) =>
        current?.map((item) => (item.id === repoId ? { ...item, ai_consent: consent.enabled } : item)),
      )
    },
  })
}

/** Sends repository code to the LLM. Never retried. */
export function useGenerateSummary(repoId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (force: boolean) => api.generateSummary(repoId, { force }),
    retry: false,
    onSuccess: (summary: SummaryResponse) => client.setQueryData(queryKeys.summary(repoId), summary),
  })
}

/**
 * Sends one file to the LLM. Never retried. The result is stored under the
 * file it was requested for, so a late response can only appear there.
 */
export function useExplainFile(repoId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (path: string) => api.explainFile(repoId, path),
    retry: false,
    onSuccess: (explanation, path) => client.setQueryData(queryKeys.explanation(repoId, path), explanation),
  })
}

/** B5: an answer stored for exactly this finding and mode (no fetch). */
export function useStoredFindingAi(repoId: string, findingId: string, mode: FindingAiMode) {
  return useQuery<FindingAiResponse | null>({
    queryKey: queryKeys.findingAi(repoId, findingId, mode),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  })
}

/**
 * B5: sends one finding and a small code window to the LLM. Never retried;
 * the answer is stored under the finding it was asked for.
 */
export function useFindingAi(repoId: string, findingId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (mode: FindingAiMode) => api.findingAi(repoId, findingId, mode),
    retry: false,
    onSuccess: (answer, mode) => client.setQueryData(queryKeys.findingAi(repoId, findingId, mode), answer),
  })
}

export function useDeleteRepository() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (repository: Repository) => api.deleteRepository(repository.id),
    onSuccess: (_result, repository) => {
      client.removeQueries({ queryKey: ['repository', repository.id] })
      client.setQueryData<Repository[]>(queryKeys.repositories, (current) =>
        current?.filter((item) => item.id !== repository.id),
      )
    },
  })
}
