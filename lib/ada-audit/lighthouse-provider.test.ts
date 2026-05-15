import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getLighthouseProvider, lighthouseOwnsNavigation } from './lighthouse-provider'

const ORIG = { ...process.env }

beforeEach(() => {
  delete process.env.LIGHTHOUSE_PROVIDER
  delete process.env.LIGHTHOUSE_ENABLED
})
afterEach(() => {
  process.env = { ...ORIG }
})

describe('getLighthouseProvider', () => {
  it('returns "off" when LIGHTHOUSE_ENABLED=false regardless of provider', () => {
    process.env.LIGHTHOUSE_ENABLED = 'false'
    process.env.LIGHTHOUSE_PROVIDER = 'pagespeed'
    expect(getLighthouseProvider()).toBe('off')
  })

  it('returns "pagespeed" when LIGHTHOUSE_PROVIDER=pagespeed', () => {
    process.env.LIGHTHOUSE_PROVIDER = 'pagespeed'
    expect(getLighthouseProvider()).toBe('pagespeed')
  })

  it('returns "pagespeed" when LIGHTHOUSE_PROVIDER=PAGESPEED (case-insensitive)', () => {
    process.env.LIGHTHOUSE_PROVIDER = 'PAGESPEED'
    expect(getLighthouseProvider()).toBe('pagespeed')
  })

  it('returns "local" as the default when LIGHTHOUSE_PROVIDER is unset', () => {
    expect(getLighthouseProvider()).toBe('local')
  })

  it('falls back to "local" for unknown values (safer default than off)', () => {
    process.env.LIGHTHOUSE_PROVIDER = 'garbage'
    expect(getLighthouseProvider()).toBe('local')
  })
})

describe('lighthouseOwnsNavigation', () => {
  it('returns true only when provider is local', () => {
    process.env.LIGHTHOUSE_PROVIDER = 'local'
    expect(lighthouseOwnsNavigation()).toBe(true)

    process.env.LIGHTHOUSE_PROVIDER = 'pagespeed'
    expect(lighthouseOwnsNavigation()).toBe(false)

    process.env.LIGHTHOUSE_ENABLED = 'false'
    expect(lighthouseOwnsNavigation()).toBe(false)
  })
})
