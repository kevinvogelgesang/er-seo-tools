// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseScoreVersion, parseScoreMeta } from './breakdown-version'

describe('parseScoreVersion', () => {
  it('reads the version from a v2 ADA breakdown', () => {
    expect(parseScoreVersion(JSON.stringify({ version: 2, scorer: 'ada-v2' }))).toBe(2)
  })
  it('reads the version from a v1 SEO breakdown', () => {
    expect(parseScoreVersion(JSON.stringify({ version: 1, scorer: 'health' }))).toBe(1)
  })
  it('defaults null/absent/garbage to 1', () => {
    expect(parseScoreVersion(null)).toBe(1)
    expect(parseScoreVersion(undefined)).toBe(1)
    expect(parseScoreVersion('not json')).toBe(1)
    expect(parseScoreVersion(JSON.stringify({ scorer: 'x' }))).toBe(1)
  })
})

describe('parseScoreMeta', () => {
  it('a v1 SEO breakdown (no weightsHash) → version 1, weightsHash null', () => {
    const blob = JSON.stringify({ version: 1, scorer: 'health', score: 72, factors: [] })
    expect(parseScoreMeta(blob)).toEqual({ version: 1, weightsHash: null })
  })
  it('a PR1 ADA v4 breakdown with weightsHash → version 4, the hash', () => {
    const blob = JSON.stringify({
      version: 4, scorer: 'ada-v4', score: 88, weightsHash: 'abc123', lowCoverage: false, deductions: [],
      inputsSummary: { pagesAudited: 10, pagesTotal: 10, meanIncomplete: 0 },
    })
    expect(parseScoreMeta(blob)).toEqual({ version: 4, weightsHash: 'abc123' })
  })
  it('defaults null/absent/garbage to version 1, weightsHash null', () => {
    expect(parseScoreMeta(null)).toEqual({ version: 1, weightsHash: null })
    expect(parseScoreMeta(undefined)).toEqual({ version: 1, weightsHash: null })
    expect(parseScoreMeta('not json')).toEqual({ version: 1, weightsHash: null })
    expect(parseScoreMeta(JSON.stringify({ scorer: 'x' }))).toEqual({ version: 1, weightsHash: null })
  })
  it('a non-string weightsHash is treated as absent', () => {
    expect(parseScoreMeta(JSON.stringify({ version: 4, weightsHash: 123 }))).toEqual({ version: 4, weightsHash: null })
  })
})
