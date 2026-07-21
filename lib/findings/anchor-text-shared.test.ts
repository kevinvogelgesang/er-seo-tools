// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  NON_DESCRIPTIVE_ANCHORS, ANCHOR_TEXT_MAX, normalizeAnchorText, isNonDescriptiveAnchor,
} from './anchor-text-shared'
import { AnchorTextParser } from '@/lib/parsers/resources/anchorText.parser'

describe('anchor-text-shared', () => {
  it('normalizeAnchorText trims and caps at ANCHOR_TEXT_MAX (no whitespace collapse)', () => {
    expect(normalizeAnchorText('  hello  ')).toBe('hello')
    expect(normalizeAnchorText('a  b')).toBe('a  b') // interior whitespace preserved (SF-faithful)
    expect(normalizeAnchorText('x'.repeat(3000)).length).toBe(ANCHOR_TEXT_MAX)
    expect(ANCHOR_TEXT_MAX).toBe(2048)
  })
  it('isNonDescriptiveAnchor is case-insensitive membership', () => {
    expect(isNonDescriptiveAnchor('Click Here')).toBe(true)
    expect(isNonDescriptiveAnchor('  read more ')).toBe(true)
    expect(isNonDescriptiveAnchor('Apply to the Nursing Program')).toBe(false)
    expect(isNonDescriptiveAnchor('')).toBe(false)
  })
  it('parity: the SF parser uses the SAME non-descriptive list', () => {
    // The parser must reference the shared constant, not a private copy.
    expect(NON_DESCRIPTIVE_ANCHORS).toEqual(
      (AnchorTextParser as unknown as { NON_DESCRIPTIVE_ANCHORS: readonly string[] }).NON_DESCRIPTIVE_ANCHORS,
    )
  })
})
