import { describe, expect, it } from 'vitest'
import { relativeLuminance, contrastRatio, contrastBands, CONTRAST_BANDS } from './contrast'

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6)
  })
  it('is monotonic in brightness', () => {
    expect(relativeLuminance('#808080')).toBeGreaterThan(relativeLuminance('#404040'))
  })
})

describe('contrastRatio', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 4)
  })
  it('identical colors are 1:1', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 6)
  })
  it('is order-independent', () => {
    expect(contrastRatio('#122033', '#fafafa')).toBeCloseTo(contrastRatio('#fafafa', '#122033'), 10)
  })
})

describe('contrastBands', () => {
  it('all bands pass at 21:1', () => {
    expect(contrastBands(21)).toEqual({ aaNormal: true, aaLarge: true })
  })
  it('exactly 4.5 passes both AA bands', () => {
    expect(contrastBands(4.5)).toEqual({ aaNormal: true, aaLarge: true })
  })
  it('3.0 passes only AA-large', () => {
    expect(contrastBands(3.0)).toEqual({ aaNormal: false, aaLarge: true })
  })
  it('band thresholds are the spec-pinned values', () => {
    expect(CONTRAST_BANDS).toEqual({ aaNormal: 4.5, aaLarge: 3.0 })
  })
})
