import { describe, expect, it } from 'vitest'
import { parsePresentationPatch, readPresentationConfig, PRESENTATION_DEFAULTS } from './presentation-config'

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
    expect(
      readPresentationConfig({
        collapseAffordance: 'pill',
        collapseMorph: 'bloom',
        heroOverlayStrength: 20,
        revealDurationScale: 1.2,
        firstLoadDelayMs: 1500,
      }),
    ).toEqual({
      collapseAffordance: 'pill',
      collapseMorph: 'bloom',
      heroOverlayStrength: 20,
      revealDurationScale: 1.2,
      firstLoadDelayMs: 1500,
      viewerMode: 'continuous',
    })
  })

  it('viewerMode: defaults to continuous when absent, accepts collapse, degrades unknown', () => {
    expect(readPresentationConfig({ collapseAffordance: 'chevron', heroOverlayStrength: 55 }).viewerMode).toBe('continuous')
    expect(readPresentationConfig({ collapseAffordance: 'chevron', heroOverlayStrength: 55, viewerMode: 'collapse' }).viewerMode).toBe('collapse')
    expect(readPresentationConfig({ collapseAffordance: 'chevron', heroOverlayStrength: 55, viewerMode: 'weird' }).viewerMode).toBe('continuous')
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

describe('collapseMorph', () => {
  it('write: rejects an unknown morph (400)', () => {
    expect(() => parsePresentationPatch({ collapseMorph: 'wobble' })).toThrow()
    expect(() => parsePresentationPatch({ collapseMorph: 7 })).toThrow()
  })

  it('write: accepts every member verbatim', () => {
    for (const m of ['spread', 'bloom', 'clip', 'pop']) {
      expect(parsePresentationPatch({ collapseMorph: m })).toEqual({ collapseMorph: m })
    }
  })

  it('read: degrades a corrupt/absent stored morph to the default (no data migration)', () => {
    expect(readPresentationConfig({ collapseAffordance: 'chevron', collapseMorph: 'garbage', heroOverlayStrength: 55 }).collapseMorph).toBe('spread')
    expect(readPresentationConfig({ collapseAffordance: 'chevron', heroOverlayStrength: 55 }).collapseMorph).toBe('spread')
  })
})

const ROW = { collapseAffordance: 'chevron', heroOverlayStrength: 55, revealDurationScale: 1.0, firstLoadDelayMs: 3000 }
describe('revealDurationScale', () => {
  it('write: accepts + clamps finite', () => {
    expect(parsePresentationPatch({ revealDurationScale: 1.4 })).toEqual({ revealDurationScale: 1.4 })
    expect(parsePresentationPatch({ revealDurationScale: 5 })).toEqual({ revealDurationScale: 1.6 })
    expect(parsePresentationPatch({ revealDurationScale: 0.1 })).toEqual({ revealDurationScale: 0.4 })
  })
  it('write: rejects non-finite/non-number', () => {
    expect(() => parsePresentationPatch({ revealDurationScale: 'x' })).toThrow()
    expect(() => parsePresentationPatch({ revealDurationScale: NaN })).toThrow()
    expect(() => parsePresentationPatch({ revealDurationScale: Infinity })).toThrow()
  })
  it('read: clamps finite-out-of-range, defaults on malformed', () => {
    expect(readPresentationConfig({ ...ROW, revealDurationScale: 9 }).revealDurationScale).toBe(1.6)
    expect(readPresentationConfig({ ...ROW, revealDurationScale: NaN }).revealDurationScale).toBe(1.0)
  })
})
describe('firstLoadDelayMs', () => {
  it('write: accepts int + clamps', () => {
    expect(parsePresentationPatch({ firstLoadDelayMs: 2000 })).toEqual({ firstLoadDelayMs: 2000 })
    expect(parsePresentationPatch({ firstLoadDelayMs: 99999 })).toEqual({ firstLoadDelayMs: 6000 })
    expect(parsePresentationPatch({ firstLoadDelayMs: -5 })).toEqual({ firstLoadDelayMs: 0 })
  })
  it('write: rejects non-integer/non-finite', () => {
    expect(() => parsePresentationPatch({ firstLoadDelayMs: 12.5 })).toThrow()
    expect(() => parsePresentationPatch({ firstLoadDelayMs: 'soon' })).toThrow()
  })
  it('defaults present', () => {
    expect(PRESENTATION_DEFAULTS.revealDurationScale).toBe(1.0)
    expect(PRESENTATION_DEFAULTS.firstLoadDelayMs).toBe(3000)
  })
})

describe('viewerMode (write)', () => {
  it('rejects an unknown viewerMode with HttpError(400, invalid_viewer_mode)', () => {
    try {
      parsePresentationPatch({ viewerMode: 'weird' })
      throw new Error('expected parsePresentationPatch to throw')
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400)
      expect((err as { code?: string }).code).toBe('invalid_viewer_mode')
    }
  })
  it('rejects a non-string viewerMode (400)', () => {
    expect(() => parsePresentationPatch({ viewerMode: 7 })).toThrow()
    expect(() => parsePresentationPatch({ viewerMode: null })).toThrow()
  })
  it('accepts both members verbatim', () => {
    expect(parsePresentationPatch({ viewerMode: 'continuous' })).toEqual({ viewerMode: 'continuous' })
    expect(parsePresentationPatch({ viewerMode: 'collapse' })).toEqual({ viewerMode: 'collapse' })
  })
  it('threads alongside other fields in one patch', () => {
    expect(parsePresentationPatch({ viewerMode: 'collapse', heroOverlayStrength: 10 })).toEqual({
      viewerMode: 'collapse',
      heroOverlayStrength: 10,
    })
  })
  it('defaults present', () => {
    expect(PRESENTATION_DEFAULTS.viewerMode).toBe('continuous')
  })
})
