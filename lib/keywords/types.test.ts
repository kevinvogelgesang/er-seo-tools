import { describe, it, expect } from 'vitest'
import { CANNIBALIZATION_REPORT_CAP } from './types'

describe('cannibalization report constants', () => {
  it('caps the report payload at 200 entries', () => {
    expect(CANNIBALIZATION_REPORT_CAP).toBe(200)
  })
})
