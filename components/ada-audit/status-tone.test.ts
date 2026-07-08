import { describe, it, expect } from 'vitest'
import { auditStatusTone } from './status-tone'

describe('auditStatusTone (color-preserving map, PR5 spec §5)', () => {
  it('maps lifecycle statuses to the tone matching their current color', () => {
    expect(auditStatusTone('complete')).toBe('success')          // green
    expect(auditStatusTone('error')).toBe('error')                // red
    expect(auditStatusTone('running')).toBe('warning')            // amber (preserved)
    expect(auditStatusTone('pdfs-running')).toBe('warning')       // amber
    expect(auditStatusTone('lighthouse-running')).toBe('warning') // amber
    expect(auditStatusTone('redirected')).toBe('running')         // blue (preserved)
  })

  it('falls back to neutral for queued/pending/cancelled/unknown', () => {
    expect(auditStatusTone('queued')).toBe('neutral')
    expect(auditStatusTone('pending')).toBe('neutral')
    expect(auditStatusTone('cancelled')).toBe('neutral')
    expect(auditStatusTone('something-else')).toBe('neutral')
  })
})
