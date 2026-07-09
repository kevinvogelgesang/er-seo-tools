// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import CommonIssueCallout from './CommonIssueCallout'
import type { CommonIssue } from '@/lib/ada-audit/types'

const issue: CommonIssue = {
  ruleId: 'image-alt', impact: 'critical', help: 'Images must have alt text', description: '', helpUrl: 'https://x.test/rules/image-alt',
  affectedPagesCount: 4, totalPagesScanned: 10, sharedAncestor: null, ancestorConfidence: null,
  tier: 'template', canonicalSelector: 'img.logo', selectorConfidence: 0.9, examplePageUrl: 'https://x.test/a',
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('CommonIssueCallout (C18 expandable patterns)', () => {
  it('never renders the removed "View affected pages" CTA', () => {
    render(<CommonIssueCallout issues={[issue]} siteAuditId="sa1" />)
    expect(screen.queryByText(/View affected pages/i)).toBeNull()
  })

  it('lazy-loads and shows the element sample on expand (authed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        found: true, childAuditId: 'c1', archived: false,
        nodes: [{ html: '<img class="logo">', target: ['img.logo'], screenshotPath: 'image-alt-0.png' }],
      }),
    } as Response)))
    render(<CommonIssueCallout issues={[issue]} siteAuditId="sa1" />)
    fireEvent.click(screen.getByRole('button', { name: /show affected elements/i }))
    expect(await screen.findByText((c) => c.includes('<img class="logo">'))).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/site-audit/sa1/pattern-sample?rule=image-alt'))
  })

  it('omits the expand control in shareMode', () => {
    render(<CommonIssueCallout issues={[issue]} siteAuditId="sa1" shareMode />)
    expect(screen.queryByRole('button', { name: /affected elements/i })).toBeNull()
  })
})
