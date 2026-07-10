// components/clients/alert-tone.test.ts
import { describe, it, expect } from 'vitest'
import { alertTone } from './alert-tone'

describe('alertTone', () => {
  it.each([
    ['error', 'red'],
    ['score-drop', 'amber'],
    ['stale', 'gray'],
    ['regression', 'purple'],
  ] as const)('%s → %s', (kind, tone) => {
    expect(alertTone(kind)).toBe(tone)
  })
})
