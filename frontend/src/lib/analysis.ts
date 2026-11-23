import type { AnalysisResponse } from '../types'

export type MessageTone = 'success' | 'warning' | 'error'

export interface AnalysisOutcome {
  tone: MessageTone
  message: string
  failedTools: string[]
  completedTools: string[]
}

/** Describe an analysis run honestly, including analyzers that did not run. */
export function describeAnalysis(result: AnalysisResponse): AnalysisOutcome {
  const entries = Object.entries(result.tool_status)
  const completedTools = entries
    .filter(([, status]) => status.status.toLowerCase() === 'completed')
    .map(([tool]) => tool)
  const failedTools = entries
    .filter(([, status]) => status.status.toLowerCase() !== 'completed')
    .map(([tool]) => tool)

  const findings = result.summary.total_findings
  const findingText = `${findings} finding${findings === 1 ? '' : 's'}`

  if (completedTools.length === 0) {
    return {
      tone: 'error',
      message: 'Analysis failed: no analyzer could run. Check that Ruff and Bandit are installed.',
      failedTools,
      completedTools,
    }
  }

  if (failedTools.length > 0) {
    return {
      tone: 'warning',
      message: `Partial analysis: ${findingText} from ${completedTools.join(', ')}. Not run: ${failedTools.join(', ')}.`,
      failedTools,
      completedTools,
    }
  }

  return {
    tone: 'success',
    message: `Analysis completed: ${findingText} from ${completedTools.join(', ')}.`,
    failedTools,
    completedTools,
  }
}
