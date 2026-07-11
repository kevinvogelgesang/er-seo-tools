import { describe, it, expect } from 'vitest'
import {
  normalizeProgramName, validatePrograms, parsePrograms, parseSuggestions,
  MAX_PROGRAMS, INSTITUTION_TYPES,
} from './program-roster'

describe('normalizeProgramName', () => {
  it('trims, lowercases, collapses whitespace', () => {
    expect(normalizeProgramName('  Dental   Assisting ')).toBe('dental assisting')
  })
})

describe('validatePrograms', () => {
  it('accepts a valid roster and stamps confirmed:true', () => {
    const r = validatePrograms([{ name: 'Dental Assisting', url: 'https://x.edu/programs/da', credentialLevel: 'diploma' }])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.programs[0].confirmed).toBe(true)
      expect(r.programs[0].name).toBe('Dental Assisting')
    }
  })
  it('rejects non-array', () => {
    expect(validatePrograms('nope').ok).toBe(false)
  })
  it('rejects empty/too-long names with a per-entry reason', () => {
    const r = validatePrograms([{ name: '' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/entry 0/)
    expect(validatePrograms([{ name: 'x'.repeat(201) }]).ok).toBe(false)
  })
  it('rejects non-http(s) and oversized urls', () => {
    expect(validatePrograms([{ name: 'A', url: 'ftp://x' }]).ok).toBe(false)
    expect(validatePrograms([{ name: 'A', url: 'not a url' }]).ok).toBe(false)
    expect(validatePrograms([{ name: 'A', url: 'https://x.edu/' + 'p'.repeat(500) }]).ok).toBe(false)
  })
  it('rejects >10 aliases, bad alias, bad credentialLevel, bad source', () => {
    expect(validatePrograms([{ name: 'A', aliases: Array(11).fill('a') }]).ok).toBe(false)
    expect(validatePrograms([{ name: 'A', aliases: [''] }]).ok).toBe(false)
    expect(validatePrograms([{ name: 'A', credentialLevel: 'x'.repeat(101) }]).ok).toBe(false)
    expect(validatePrograms([{ name: 'A', source: 'robot' }]).ok).toBe(false)
  })
  it('rejects rosters over MAX_PROGRAMS', () => {
    const many = Array.from({ length: MAX_PROGRAMS + 1 }, (_, i) => ({ name: `P${i}` }))
    expect(validatePrograms(many).ok).toBe(false)
  })
  it('rejects duplicate normalized names (clean KS-5 seed set — plan-Codex #3 adjunct)', () => {
    const r = validatePrograms([{ name: 'Dental Assisting' }, { name: 'dental  assisting' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/duplicate/)
  })
})

describe('defensive parsing', () => {
  it('parsePrograms: [] on null, garbage, non-array', () => {
    expect(parsePrograms(null)).toEqual([])
    expect(parsePrograms('{oops')).toEqual([])
    expect(parsePrograms('"str"')).toEqual([])
  })
  it('parsePrograms: drops malformed entries (bad name, bad url type, bad aliases), keeps valid ones', () => {
    const json = JSON.stringify([
      { name: 'Good', confirmed: true },
      { nope: 1 }, null, { name: 42 }, { name: 'BadUrl', confirmed: true, url: 7 },
      { name: 'BadAliases', confirmed: true, aliases: 'x' },
    ])
    expect(parsePrograms(json)).toEqual([{ name: 'Good', confirmed: true }])
  })
  it('parsePrograms is as strict as validatePrograms: drops every axis the write side rejects', () => {
    const wrap = (entry: Record<string, unknown>) =>
      parsePrograms(JSON.stringify([{ name: 'Keep', confirmed: true }, entry]))
    const onlyKeep = [{ name: 'Keep', confirmed: true }]
    // bad url scheme
    expect(wrap({ name: 'A', confirmed: true, url: 'javascript:alert(1)' })).toEqual(onlyKeep)
    expect(wrap({ name: 'A', confirmed: true, url: 'ftp://x' })).toEqual(onlyKeep)
    // oversized url (>500)
    expect(wrap({ name: 'A', confirmed: true, url: 'https://x.edu/' + 'p'.repeat(500) })).toEqual(onlyKeep)
    // over-cap aliases (>10)
    expect(wrap({ name: 'A', confirmed: true, aliases: Array(50).fill('a') })).toEqual(onlyKeep)
    // empty alias
    expect(wrap({ name: 'A', confirmed: true, aliases: [''] })).toEqual(onlyKeep)
    // oversized alias (>100)
    expect(wrap({ name: 'A', confirmed: true, aliases: ['x'.repeat(101)] })).toEqual(onlyKeep)
    // oversized credentialLevel (>100)
    expect(wrap({ name: 'A', confirmed: true, credentialLevel: 'x'.repeat(101) })).toEqual(onlyKeep)
    // invalid source
    expect(wrap({ name: 'A', confirmed: true, source: 'robot' })).toEqual(onlyKeep)
    // non-string addedAt
    expect(wrap({ name: 'A', confirmed: true, addedAt: 12345 })).toEqual(onlyKeep)
    // oversized name (>200 trimmed)
    expect(wrap({ name: 'x'.repeat(201), confirmed: true })).toEqual(onlyKeep)
  })
  it('parsePrograms: drops entries without a literal confirmed:true stamp', () => {
    const json = JSON.stringify([
      { name: 'NotConfirmed', confirmed: false },
      { name: 'NoStamp' },
      { name: 'Truthy', confirmed: 1 },
      { name: 'Good', confirmed: true },
    ])
    expect(parsePrograms(json)).toEqual([{ name: 'Good', confirmed: true }])
  })
  it('parsePrograms: returns fresh sanitized entries — extra properties are stripped, name/aliases trimmed', () => {
    const json = JSON.stringify([
      { name: '  Good  ', confirmed: true, aliases: [' a1 '], evil: 'payload', extra: { deep: true } },
    ])
    expect(parsePrograms(json)).toEqual([{ name: 'Good', confirmed: true, aliases: ['a1'] }])
  })
  it('parsePrograms: name length limit uses trimmed length (consistent with write side)', () => {
    const name = '  ' + 'x'.repeat(200) + '  ' // untrimmed 204, trimmed exactly 200
    expect(parsePrograms(JSON.stringify([{ name, confirmed: true }]))).toEqual([
      { name: 'x'.repeat(200), confirmed: true },
    ])
  })
  it('parseSuggestions: null on garbage or wrong version; drops malformed suggestion entries and non-string dismissed names', () => {
    expect(parseSuggestions(null)).toBeNull()
    expect(parseSuggestions('{oops')).toBeNull()
    expect(parseSuggestions(JSON.stringify({ v: 2 }))).toBeNull()
    const dirty = JSON.stringify({
      v: 1, derivedFromRunId: 'r', derivedAt: 'd',
      suggestions: [{ name: 'OK', evidence: ['slug'] }, { name: 5, evidence: ['slug'] }, { name: 'BadEv', evidence: ['robot'] }, 'junk'],
      dismissedNames: ['ok', 42],
    })
    const p = parseSuggestions(dirty)
    expect(p!.suggestions).toEqual([{ name: 'OK', evidence: ['slug'] }])
    expect(p!.dismissedNames).toEqual(['ok'])
  })
  it('parseSuggestions: round-trips a valid payload', () => {
    const p = { v: 1, derivedFromRunId: 'r1', derivedAt: '2026-07-10T00:00:00Z', suggestions: [{ name: 'X', evidence: ['slug'] }], dismissedNames: [] }
    expect(parseSuggestions(JSON.stringify(p))).toEqual(p)
  })
})

describe('INSTITUTION_TYPES', () => {
  it('is the spec enum', () => {
    expect([...INSTITUTION_TYPES]).toEqual(['trade', 'bootcamp', 'university', 'k12', 'other'])
  })
})
