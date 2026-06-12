// lib/report/vpat.ts — pure VPAT 2.4-shaped markdown scaffold from Violation rows.
// Two-state honesty model: automation can prove failures, never passes.
import { criteriaForLevel, criterionFromTag, type WcagCriterion } from './wcag-criteria'

export interface VpatViolationRow {
  ruleId: string
  impact: string
  wcagTags: string[]      // parsed
  helpUrl: string | null
  pageUrl: string
}

export interface VpatInput {
  domain: string
  auditDate: string       // ISO
  wcagLevel: string       // 'wcag21aa' | 'wcag22aa'
  pagesTotal: number
  rows: VpatViolationRow[]
}

interface RuleAgg { impact: string; helpUrl: string | null; pages: Set<string> }

export function buildVpatScaffold(input: VpatInput): string {
  // criterion id → (ruleId → agg)
  const byCriterion = new Map<string, Map<string, RuleAgg>>()
  for (const row of input.rows) {
    for (const tag of row.wcagTags) {
      const cid = criterionFromTag(tag)
      if (!cid) continue
      let rules = byCriterion.get(cid)
      if (!rules) { rules = new Map(); byCriterion.set(cid, rules) }
      let agg = rules.get(row.ruleId)
      if (!agg) { agg = { impact: row.impact, helpUrl: row.helpUrl, pages: new Set() }; rules.set(row.ruleId, agg) }
      agg.pages.add(row.pageUrl)
    }
  }

  const criteria = criteriaForLevel(input.wcagLevel)
  const renderRow = (c: WcagCriterion): string => {
    const rules = byCriterion.get(c.id)
    if (!rules || rules.size === 0) {
      return `| ${c.id} ${c.name} | Not Evaluated | No automated failures detected; manual review required. |`
    }
    const remarks = [...rules.entries()]
      .map(([ruleId, a]) =>
        `\`${ruleId}\` (${a.impact}, ${a.pages.size} page${a.pages.size === 1 ? '' : 's'}${a.helpUrl ? `, ${a.helpUrl}` : ''})`)
      .join('; ')
    return `| ${c.id} ${c.name} | Does Not Support | Automated failures: ${remarks} |`
  }
  const table = (level: 'A' | 'AA') => [
    '| Criteria | Conformance Level | Remarks and Explanations |',
    '|---|---|---|',
    ...criteria.filter((c) => c.level === level).map(renderRow),
  ].join('\n')

  const levelLabel = input.wcagLevel === 'wcag22aa' ? 'WCAG 2.2 AA (incl. best-practice rules)' : 'WCAG 2.1 AA'
  const wcag22Note = input.wcagLevel === 'wcag22aa'
    ? ''
    : '\n> WCAG 2.2-only criteria are **not in scan scope** for this audit (run at WCAG 2.1 AA) and are omitted.\n'

  return `# Accessibility Conformance Report Scaffold (VPAT® 2.4 shape) — ${input.domain}

**This is a scaffold, not a legal VPAT/ACR.** It is generated from a single
automated axe-core scan and MUST be completed by a human evaluator before any
external use. Automated scanning can demonstrate failures but can never
demonstrate conformance.

- **Product / site:** ${input.domain}
- **Report date:** ${input.auditDate.slice(0, 10)}
- **Evaluation methods:** automated axe-core scan via ER SEO Tools (${input.pagesTotal} pages, ${levelLabel})
- **Conformance vocabulary:** Supports / Partially Supports / Does Not Support / Not Applicable / Not Evaluated
${wcag22Note}
## Table 1: Success Criteria, Level A

${table('A')}

## Table 2: Success Criteria, Level AA

${table('AA')}
`
}
