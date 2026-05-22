import { describe, it, expect } from 'vitest'
import { isNoiseRequest, NOISE_HOSTS } from './scanner-noise'

describe('isNoiseRequest — hostname matcher', () => {
  it('matches exact hostname', () => {
    expect(isNoiseRequest('https://www.google-analytics.com/g/collect?v=2', 'xhr')).toBe(true)
  })

  it('matches subdomain via suffix rule', () => {
    expect(isNoiseRequest('https://sub.googletagmanager.com/gtm.js', 'script')).toBe(true)
  })

  it('does not match a non-noise first-party host', () => {
    expect(isNoiseRequest('https://www.soma.edu/about/', 'document')).toBe(false)
  })

  it('does not match a host that happens to contain a noise name as a substring', () => {
    expect(isNoiseRequest('https://googletagmanager.com.evil.example/', 'script')).toBe(false)
  })

  it('blocks "media" resource type regardless of host', () => {
    expect(isNoiseRequest('https://www.soma.edu/video.mp4', 'media')).toBe(true)
  })

  it('does not block image/font/css/script even on noise-looking hosts (only by exact list)', () => {
    expect(isNoiseRequest('https://example.com/image.png', 'image')).toBe(false)
    expect(isNoiseRequest('https://example.com/font.woff2', 'font')).toBe(false)
    expect(isNoiseRequest('https://example.com/style.css', 'stylesheet')).toBe(false)
  })

  it('rejects malformed URLs silently (returns false)', () => {
    expect(isNoiseRequest('not-a-url', 'xhr')).toBe(false)
    expect(isNoiseRequest('', 'xhr')).toBe(false)
  })

  it('uses lower-cased host comparison', () => {
    expect(isNoiseRequest('https://WWW.GOOGLE-ANALYTICS.com/g/collect', 'xhr')).toBe(true)
  })

  it('the exported NOISE_HOSTS list is non-empty and contains documented entries', () => {
    expect(NOISE_HOSTS.length).toBeGreaterThan(20)
    expect(NOISE_HOSTS).toContain('googletagmanager.com')
    expect(NOISE_HOSTS).toContain('static.hotjar.com')
  })

  it('blocks all subdomains of google-analytics.com via the bare entry', () => {
    expect(isNoiseRequest('https://www.google-analytics.com/g/collect', 'xhr')).toBe(true)
    expect(isNoiseRequest('https://region1.google-analytics.com/collect', 'xhr')).toBe(true)
    expect(isNoiseRequest('https://ssl.google-analytics.com/r/collect', 'xhr')).toBe(true)
  })

  it('explicitly does NOT block FB SDK or Intercom (accessibility-relevant widgets)', () => {
    expect(NOISE_HOSTS).not.toContain('connect.facebook.net')
    expect(NOISE_HOSTS).not.toContain('widget.intercom.io')
    expect(NOISE_HOSTS).not.toContain('js.intercom.io')
    expect(isNoiseRequest('https://connect.facebook.net/en_US/sdk.js', 'script')).toBe(false)
    expect(isNoiseRequest('https://widget.intercom.io/widget/abc123', 'script')).toBe(false)
  })
})
