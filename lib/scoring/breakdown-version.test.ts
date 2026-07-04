// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseScoreVersion } from './breakdown-version'

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
