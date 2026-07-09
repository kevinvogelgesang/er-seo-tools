import { describe, it, expect } from 'vitest'
import { reportStatusTone } from './status-tone'

describe('reportStatusTone (color-preserving map, A8 reports polish)', () => {
  it('maps report + batch statuses to the tone matching their current color', () => {
    expect(reportStatusTone('ready')).toBe('success')     // green
    expect(reportStatusTone('complete')).toBe('success')  // green (batch)
    expect(reportStatusTone('error')).toBe('error')       // red
    expect(reportStatusTone('running')).toBe('running')   // blue (batch)
  })

  it('keeps the transient report statuses blue via the running tone', () => {
    expect(reportStatusTone('queued')).toBe('running')    // blue (preserved)
    expect(reportStatusTone('fetching')).toBe('running')  // blue (preserved)
    expect(reportStatusTone('rendering')).toBe('running') // blue (preserved)
  })

  it('falls back to neutral for unknown values', () => {
    expect(reportStatusTone('something-else')).toBe('neutral')
    expect(reportStatusTone('')).toBe('neutral')
  })
})
