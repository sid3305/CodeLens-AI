import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../services/api'
import type { AiConsent, AnalysisResponse, ExplainResponse, Repository, SummaryResponse } from '../types'
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

export function useDependencies(repoId: string) {
  return useQuery({
    queryKey: queryKeys.dependencies(repoId),
    queryFn: ({ signal }) => api.getDependenciesAnalysis(repoId, { signal }),
  })
}

/** B6: AI consent for a repository and the provider that would receive code. */
export function useAiConsent(repoId: string) {
  return useQuery({
    queryKey: queryKeys.aiConsent(repoId),
    queryFn: ({ signal }) => api.getAiConsent(repoId, signal),
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

export function useRunAnalysis(repoId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.analyzeRepository(repoId),
    onSuccess: (result: AnalysisResponse) => client.setQueryData(queryKeys.analysis(repoId), result),
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

export function useRefreshDependencies(repoId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.getDependenciesAnalysis(repoId, { refresh: true }),
    onSuccess: (data) => client.setQueryData(queryKeys.dependencies(repoId), data),
  })
}

export function useImportZip() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => api.uploadRepository(file),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.repositories }),
  })
}

export function useImportLink() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (url: string) => api.importGitHub(url),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.repositories }),
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
