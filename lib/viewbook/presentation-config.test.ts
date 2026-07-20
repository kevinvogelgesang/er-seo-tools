import { describe, expect, it } from 'vitest'
import { parsePresentationPatch, readPresentationConfig } from './presentation-config'

describe('parsePresentationPatch', () => {
  it('rejects an unknown affordance (400)', () => {
    expect(() => parsePresentationPatch({ collapseAffordance: 'zzz' })).toThrow()
  })

  it('rejects a non-integer / non-finite overlay (400, not coerced)', () => {
    expect(() => parsePresentationPatch({ heroOverlayStrength: Number.NaN })).toThrow()
    expect(() => parsePresentationPatch({ heroOverlayStrength: 'high' })).toThrow()
    expect(() => parsePresentationPatch({ heroOverlayStrength: 12.5 })).toThrow() // Number.isInteger gate
  })

  it('clamps a valid overlay into [0,100]', () => {
    expect(parsePresentationPatch({ heroOverlayStrength: 250 })).toEqual({ heroOverlayStrength: 100 })
    expect(parsePresentationPatch({ heroOverlayStrength: -5 })).toEqual({ heroOverlayStrength: 0 })
  })

  it('accepts a valid affordance and returns it verbatim', () => {
    expect(parsePresentationPatch({ collapseAffordance: 'pill' })).toEqual({ collapseAffordance: 'pill' })
  })

  it('returns an empty patch for an empty/irrelevant input', () => {
    expect(parsePresentationPatch({})).toEqual({})
    expect(parsePresentationPatch({ unrelated: true })).toEqual({})
  })

  it('accepts both fields at once', () => {
    expect(parsePresentationPatch({ collapseAffordance: 'chevron', heroOverlayStrength: 10 })).toEqual({
      collapseAffordance: 'chevron',
      heroOverlayStrength: 10,
    })
  })
})

describe('readPresentationConfig', () => {
  it('read degrades a corrupt stored affordance to the default', () => {
    expect(readPresentationConfig({ collapseAffordance: 'garbage', heroOverlayStrength: 55 }).collapseAffordance).toBe('chevron')
  })

  it('degrades a legacy stored "bar" row to the default (bar dropped 2026-07-19, no data migration)', () => {
    expect(readPresentationConfig({ collapseAffordance: 'bar', heroOverlayStrength: 55 }).collapseAffordance).toBe('chevron')
  })

  it('passes through a valid stored row unchanged', () => {
    expect(readPresentationConfig({ collapseAffordance: 'pill', heroOverlayStrength: 20 })).toEqual({
      collapseAffordance: 'pill',
      heroOverlayStrength: 20,
    })
  })

  it('degrades a non-finite stored overlay to the default', () => {
    expect(readPresentationConfig({ collapseAffordance: 'bar', heroOverlayStrength: Number.NaN }).heroOverlayStrength).toBe(55)
  })

  it('clamps an out-of-range stored overlay into [0,100]', () => {
    expect(readPresentationConfig({ collapseAffordance: 'bar', heroOverlayStrength: 250 }).heroOverlayStrength).toBe(100)
    expect(readPresentationConfig({ collapseAffordance: 'bar', heroOverlayStrength: -5 }).heroOverlayStrength).toBe(0)
  })

  it('never throws', () => {
    expect(() => readPresentationConfig({ collapseAffordance: 123 as unknown as string, heroOverlayStrength: 'x' as unknown as number })).not.toThrow()
  })
})
