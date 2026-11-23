export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info'

export const SEVERITIES: Severity[] = ['Critical', 'High', 'Medium', 'Low', 'Info']

export function normaliseSeverity(value: string): Severity {
  const match = SEVERITIES.find(
    (severity) => severity.toLowerCase() === value.trim().toLowerCase(),
  )
  return match ?? 'Info'
}
