// lib/ada-audit/browser-request-guard.ts
//
// The ONE browser request-interception layer (Codex F2). Both the sitemap
// browser-fetch and the rendered link crawl install it — the SSRF + subresource
// + off-domain-redirect policy lives here, never re-copied.
import type { HTTPRequest, Page } from 'puppeteer-core'
import { assertSafeHttpUrl } from '../security/safe-url'
import { sameDomain } from './link-harvest'

// Subresources a <a href> harvest / sitemap XML fetch never needs — blocking
// them caps per-render memory + time.
const BLOCKED_SUBRESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet'])

export interface BrowserRequestGuardOpts {
  // When set, an off-domain MAIN-FRAME navigation (redirect) is aborted BEFORE
  // the page renders — rejecting the final URL afterward would already have
  // scanned a third-party page (owner rule). Undefined ⇒ no host pinning.
  auditedHost?: string
  // When true, image/media/font/stylesheet subresource loads are aborted.
  blockSubresources?: boolean
}

export type BrowserRequestVerdict = 'block-subresource' | 'block-off-domain-nav' | 'check-ssrf'

/** Pure fate of a request BEFORE the async SSRF check (unit-tested). */
export function classifyBrowserRequest(
  req: { url: string; resourceType: string; isNavigationRequest: boolean; isMainFrame: boolean },
  opts: BrowserRequestGuardOpts,
): BrowserRequestVerdict {
  if (opts.blockSubresources && !req.isNavigationRequest && BLOCKED_SUBRESOURCE_TYPES.has(req.resourceType)) {
    return 'block-subresource'
  }
  if (opts.auditedHost !== undefined && req.isNavigationRequest && req.isMainFrame) {
    let host: string
    try { host = new URL(req.url).hostname.toLowerCase() } catch { return 'block-off-domain-nav' }
    if (!sameDomain(host, opts.auditedHost.toLowerCase())) return 'block-off-domain-nav'
  }
  return 'check-ssrf'
}

/** Install the guard on a page. No opts ⇒ SSRF-only (sitemap-fetch behavior). */
export async function installBrowserRequestGuard(page: Page, opts: BrowserRequestGuardOpts = {}): Promise<void> {
  await page.setRequestInterception(true)
  page.on('request', (request: HTTPRequest) => {
    void (async () => {
      // Codex F3: the whole handler is wrapped so a throw from frame()/metadata
      // during a page close/disconnect can never become an unhandled rejection
      // (which could crash the job worker) — on any failure, best-effort abort.
      try {
        // Only read frame() when host-pinning is active — the sitemap-fetch
        // caller (no auditedHost) must not depend on frame() being present.
        const isMainFrame = opts.auditedHost !== undefined ? request.frame() === page.mainFrame() : false
        const verdict = classifyBrowserRequest(
          {
            url: request.url(),
            resourceType: request.resourceType(),
            isNavigationRequest: request.isNavigationRequest(),
            isMainFrame,
          },
          opts,
        )
        if (verdict !== 'check-ssrf') {
          if (!request.isInterceptResolutionHandled()) await request.abort('blockedbyclient').catch(() => {})
          return
        }
        try {
          await assertSafeHttpUrl(request.url())
          if (!request.isInterceptResolutionHandled()) await request.continue()
        } catch {
          if (!request.isInterceptResolutionHandled()) await request.abort('blockedbyclient').catch(() => {})
        }
      } catch {
        try {
          if (!request.isInterceptResolutionHandled()) await request.abort('blockedbyclient').catch(() => {})
        } catch { /* page gone — nothing more we can do */ }
      }
    })()
  })
}
