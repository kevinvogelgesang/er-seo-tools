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
  it('sorts by name FIRST, url second — full output order pinned (catches a swapped primary sort key)', () => {
    // url order and name order deliberately DISAGREE: sorting url-first would
    // put 'zz prog' (at /a) before 'aa prog' (at /z).
    const out = aggregateProgramEntities([
      row('https://x.edu/a', ['zz prog']),
      row('https://x.edu/z', ['aa prog']),
      row('https://x.edu/m', ['mm prog']),
    ])
    expect(out).toEqual({
      v: 1,
      entities: [
        { name: 'aa prog', url: 'https://x.edu/z' },
        { name: 'mm prog', url: 'https://x.edu/m' },
        { name: 'zz prog', url: 'https://x.edu/a' },
      ],
    })
  })
  it('caps at 100 entities AFTER sorting — the name-smallest 100 survive (catches cap-before-sort)', () => {
    // Name order is the REVERSE of url/input order: Program 119..000 at p0..p119.
    // A cap applied before sorting would keep Program 119..020 instead.
    const rows = Array.from({ length: 120 }, (_, i) =>
      row(`https://x.edu/p${i}`, [`Program ${String(119 - i).padStart(3, '0')}`]),
    )
    const entities = aggregateProgramEntities(rows)!.entities
    expect(entities).toHaveLength(100)
    expect(entities[0]).toEqual({ name: 'Program 000', url: 'https://x.edu/p119' })
    expect(entities[99]).toEqual({ name: 'Program 099', url: 'https://x.edu/p20' })
    expect(entities.map((e) => e.name)).toEqual(
      Array.from({ length: 100 }, (_, i) => `Program ${String(i).padStart(3, '0')}`),
    )
  })
})
