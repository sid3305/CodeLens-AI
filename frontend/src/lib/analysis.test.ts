import { describe, expect, it } from 'vitest'

import { describeAnalysis } from './analysis'
import type { AnalysisResponse } from '../types'

function result(tools: Record<string, string>, total = 3): AnalysisResponse {
  return {
    repository_id: 'r',
    repository_name: 'r',
    status: 'completed',
    analyzed_at: '',
    summary: {
      total_findings: total,
      raw_total_findings: total,
      duplicates_removed: 0,
      severity_counts: {},
      category_counts: {},
      tool_counts: {},
    },
    tool_status: Object.fromEntries(
      Object.entries(tools).map(([tool, status]) => [
        tool,
        { status, findings: 0, error: null },
      ]),
    ),
    findings: [],
  }
}

describe('describeAnalysis (A3 / BUG-19)', () => {
  it('reports success only when every analyzer ran', () => {
    const outcome = describeAnalysis(result({ Ruff: 'Completed', Bandit: 'Completed' }))
    expect(outcome.tone).toBe('success')
  })

  it('names analyzers that did not run', () => {
    const outcome = describeAnalysis(
      result({ Ruff: 'Completed', Bandit: 'Completed', Semgrep: 'Failed', Gitleaks: 'Failed' }),
    )
    expect(outcome.tone).toBe('warning')
    expect(outcome.message).toContain('Not run: Semgrep, Gitleaks')
    expect(outcome.message).toContain('from Ruff, Bandit')
  })

  it('reports an error when nothing ran', () => {
    expect(describeAnalysis(result({ Ruff: 'Failed' })).tone).toBe('error')
  })
})
