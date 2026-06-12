import { describe, it, expect } from 'vitest'
import { csvField, buildCsv, safeFilenamePart } from './csv'

describe('csvField', () => {
  it('passes plain values through', () => {
    expect(csvField('hello')).toBe('hello')
  })

  it('quotes commas, quotes, newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('neutralizes formula injection (=, +, -, @, tab, CR)', () => {
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvField('+1')).toBe("'+1")
    expect(csvField('-1')).toBe("'-1")
    expect(csvField('@cmd')).toBe("'@cmd")
    // leading tab: neutralized first, then RFC-quoted because a tab is present
    expect(csvField('\tx')).toBe(`"'\tx"`)
    expect(csvField('\rx')).toBe(`"'\rx"`)
  })

  it('neutralized formula with comma is also quoted', () => {
    expect(csvField('=1,2')).toBe(`"'=1,2"`)
  })

  it('renders null/undefined as empty and numbers verbatim', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
    expect(csvField(42)).toBe('42')
    expect(csvField(0)).toBe('0')
  })
})

describe('buildCsv', () => {
  it('emits BOM + CRLF rows', () => {
    const out = buildCsv(['a', 'b'], [['1', 'x,y']])
    expect(out).toBe('﻿a,b\r\n1,"x,y"')
  })

  it('handles empty rows', () => {
    expect(buildCsv(['only'], [])).toBe('﻿only')
  })
})

describe('safeFilenamePart', () => {
  it('keeps domain-safe chars', () => {
    expect(safeFilenamePart('www.example-site.com')).toBe('www.example-site.com')
  })
  it('strips quotes, CRLF, slashes', () => {
    expect(safeFilenamePart('a"b\r\nc/d\\e')).toBe('a_b__c_d_e')
  })
})
