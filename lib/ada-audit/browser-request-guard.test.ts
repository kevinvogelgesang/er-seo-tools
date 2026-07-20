// lib/ada-audit/browser-request-guard.test.ts
import { describe, it, expect } from 'vitest'
import { classifyBrowserRequest } from './browser-request-guard'

const nav = (url: string) => ({ url, resourceType: 'document', isNavigationRequest: true, isMainFrame: true })
const sub = (url: string, resourceType: string) => ({ url, resourceType, isNavigationRequest: false, isMainFrame: false })

describe('classifyBrowserRequest', () => {
  it('SSRF-only when no opts (sitemap fetch behavior)', () => {
    expect(classifyBrowserRequest(sub('https://x.com/a.png', 'image'), {})).toBe('check-ssrf')
    expect(classifyBrowserRequest(nav('https://other.com/'), {})).toBe('check-ssrf')
  })
  it('blocks subresource types only when blockSubresources is set', () => {
    for (const t of ['image', 'media', 'font', 'stylesheet']) {
      expect(classifyBrowserRequest(sub('https://x.com/a', t), { blockSubresources: true })).toBe('block-subresource')
    }
    expect(classifyBrowserRequest(sub('https://x.com/x.js', 'script'), { blockSubresources: true })).toBe('check-ssrf')
    // a main-frame navigation is never a "subresource" even with the flag
    expect(classifyBrowserRequest(nav('https://x.com/'), { blockSubresources: true, auditedHost: 'x.com' })).toBe('check-ssrf')
  })
  it('aborts an off-domain main-frame navigation when auditedHost is set', () => {
    expect(classifyBrowserRequest(nav('https://evil.com/'), { auditedHost: 'x.com' })).toBe('block-off-domain-nav')
    expect(classifyBrowserRequest(nav('https://www.x.com/'), { auditedHost: 'x.com' })).toBe('check-ssrf') // www-insensitive
    expect(classifyBrowserRequest(nav('not a url'), { auditedHost: 'x.com' })).toBe('block-off-domain-nav')
  })
  it('does NOT host-pin a sub-frame or subresource request', () => {
    expect(classifyBrowserRequest(sub('https://evil.com/a.js', 'script'), { auditedHost: 'x.com' })).toBe('check-ssrf')
  })
})
