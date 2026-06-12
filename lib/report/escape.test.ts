import { describe, it, expect } from 'vitest'
import { escapeHtml, escapeAttr } from './escape'

describe('escapeHtml', () => {
  it('escapes tags', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
  it('escapes ampersands first (no double-escaping)', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
  it('neutralizes an axe node html payload', () => {
    const out = escapeHtml('<img src=x onerror=alert(1)>')
    expect(out).toContain('&lt;img')
    expect(out).not.toContain('<img src=x')
  })
  it('leaves quotes alone (text context)', () => {
    expect(escapeHtml(`say "hi" 'there'`)).toBe(`say "hi" 'there'`)
  })
})

describe('escapeAttr', () => {
  it('escapes quotes in attribute context', () => {
    expect(escapeAttr(`" onmouseover="alert(1)`)).toBe('&quot; onmouseover=&quot;alert(1)')
    expect(escapeAttr(`it's`)).toBe('it&#39;s')
  })
  it('also escapes tags and ampersands', () => {
    expect(escapeAttr('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;')
  })
})
