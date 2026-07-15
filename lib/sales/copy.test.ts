import { describe, expect, it } from 'vitest'
import {
  ER_ADA_CTA, HIGH_VALUE_SCHEMA_TYPES, ISSUE_LABELS, ISSUE_WHY,
  SCHEMA_IMPLICATIONS, SCORE_METHOD, standardLabel, WCAG_MEANING,
} from './copy'

describe('sales copy', () => {
  it('every labelled issue type has a "why this hurts you" line', () => {
    expect(Object.keys(ISSUE_WHY).sort()).toEqual(Object.keys(ISSUE_LABELS).sort())
  })
  it('every high-value schema type has an implication line', () => {
    expect(Object.keys(SCHEMA_IMPLICATIONS).sort()).toEqual([...HIGH_VALUE_SCHEMA_TYPES].sort())
  })
  it('score methodology copy exists for all five areas', () => {
    expect(Object.keys(SCORE_METHOD).sort()).toEqual(['accessibility', 'geo', 'overall', 'performance', 'seo'])
  })
  it('honesty rules: no prospect-site compliance claims anywhere', () => {
    const all = [
      ...Object.values(ISSUE_WHY), ...Object.values(SCHEMA_IMPLICATIONS),
      ...Object.values(SCORE_METHOD).flatMap((m) => [m.summary, m.note]),
      WCAG_MEANING,
    ].join(' ')
    expect(all).not.toMatch(/wcag compliant/i)
    expect(all).not.toMatch(/core web vitals pass/i)
    // schema copy never claims markup is REQUIRED for AI quotation (Codex fix 5)
    expect(Object.values(SCHEMA_IMPLICATIONS).join(' ')).not.toMatch(/required|invisible|can't recommend|cannot recommend/i)
  })
  it('the sanctioned exception: ER_ADA_CTA claims ADA compliance about ER product sites only', () => {
    expect(ER_ADA_CTA).toMatch(/Enrollment Resources builds/i)
    expect(ER_ADA_CTA).toMatch(/ADA-compliant/)
  })
  it('standardLabel maps both levels', () => {
    expect(standardLabel('wcag21aa')).toBe('WCAG 2.1 AA')
    expect(standardLabel('wcag22aa')).toBe('WCAG 2.2 AA + best practices')
  })
})
