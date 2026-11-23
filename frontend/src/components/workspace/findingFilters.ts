import type { Finding } from '../../types'

export interface FindingFilters {
  query: string
  severity: string
  analyzer: string
}

export function filterFindings(findings: Finding[], filters: FindingFilters): Finding[] {
  const query = filters.query.trim().toLowerCase()
  return findings.filter((finding) => {
    const matchesQuery =
      !query ||
      [finding.title, finding.file, finding.rule_id, finding.description].some((text) =>
        text.toLowerCase().includes(query),
      )
    const matchesSeverity = filters.severity === 'All' || finding.severity === filters.severity
    const matchesAnalyzer = filters.analyzer === 'All' || finding.detected_by.includes(filters.analyzer)
    return matchesQuery && matchesSeverity && matchesAnalyzer
  })
}
