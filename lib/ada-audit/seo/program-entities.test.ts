import { describe, it, expect } from 'vitest'
import { aggregateProgramEntities } from './program-entities'

const row = (url: string, names: string[] | null) => ({
  url,
  detailsJson: names === null ? null : JSON.stringify({ schemaTypes: [], hreflang: [], programNames: names }),
})

describe('aggregateProgramEntities', () => {
  it('returns null when no rows carry program names (incl. pre-KS-3 detailsJson without the field)', () => {
    expect(aggregateProgramEntities([])).toBeNull()
    expect(aggregateProgramEntities([row('https://x.edu/a', [])])).toBeNull()
    expect(aggregateProgramEntities([{ url: 'https://x.edu/a', detailsJson: '{"schemaTypes":[]}' }])).toBeNull()
  })
  it('tolerates malformed detailsJson', () => {
    expect(aggregateProgramEntities([{ url: 'https://x.edu/a', detailsJson: '{broken' }])).toBeNull()
  })
  it('dedupes by normalized name; winner = pair with lexicographically smallest URL, its verbatim name kept (plan-Codex #2)', () => {
    // Input order deliberately scrambled; the (normalized name, url)-sort decides:
    // the /a pair sorts first, so ITS verbatim name ('dental assisting') wins.
    const out = aggregateProgramEntities([
      row('https://x.edu/z', ['Dental  Assisting']),
      row('https://x.edu/a', ['dental assisting']),
    ])
    expect(out).toEqual({
      v: 1,
      entities: [{ name: 'dental assisting', url: 'https://x.edu/a' }],
    })
  })
  it('caps at 100 entities', () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(`https://x.edu/p${i}`, [`Program ${String(i).padStart(3, '0')}`]))
    expect(aggregateProgramEntities(rows)!.entities).toHaveLength(100)
  })
})
