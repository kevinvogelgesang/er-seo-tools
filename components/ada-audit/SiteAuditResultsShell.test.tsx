// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// ONE stable searchParams instance + router (C17 gotcha): returning a fresh
// object each render would refire the shell's sync-effect and clobber clicks.
const h = vi.hoisted(() => ({ sp: new URLSearchParams(''), replace: (() => {}) as (...a: unknown[]) => void }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => h.sp,
  useRouter: () => ({ replace: h.replace }),
}))

import SiteAuditResultsShell from './SiteAuditResultsShell'

beforeEach(() => { h.sp = new URLSearchParams(''); h.replace = () => {} })
afterEach(cleanup)

const base = {
  domain: 'x.test',
  clientName: 'Acme',
  createdAt: '2026-07-08T00:00:00.000Z',
  pagesTotal: 10,
  pagesError: 0,
  adaScore: 82,
  seoScore: 91,
  accessibility: <div>ADA-PANEL</div>,
  seo: <div>SEO-PANEL</div>,
}

describe('SiteAuditResultsShell (C18)', () => {
  it('shows the Accessibility panel by default and switches to SEO on tab click', () => {
    render(<SiteAuditResultsShell {...base} exportBar={<div>EXPORT</div>} />)
    expect(screen.getByText('ADA-PANEL')).toBeTruthy()
    expect(screen.queryByText('SEO-PANEL')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /SEO/i }))
    expect(screen.getByText('SEO-PANEL')).toBeTruthy()
    expect(screen.queryByText('ADA-PANEL')).toBeNull()
  })

  it('seeds the active tab from ?resultTab=seo', () => {
    h.sp = new URLSearchParams('resultTab=seo')
    render(<SiteAuditResultsShell {...base} />)
    expect(screen.getByText('SEO-PANEL')).toBeTruthy()
    expect(screen.queryByText('ADA-PANEL')).toBeNull()
  })

  it('renders both score rings (ADA + SEO)', () => {
    render(<SiteAuditResultsShell {...base} />)
    // ScoreRing sets aria-label `score <n>`; disambiguates from the tab labels.
    expect(screen.getByLabelText('score 82')).toBeTruthy()
    expect(screen.getByLabelText('score 91')).toBeTruthy()
  })

  it('omits the export bar in shareMode', () => {
    render(<SiteAuditResultsShell {...base} adaScore={null} seoScore={null} exportBar={<div>EXPORT</div>} shareMode />)
    expect(screen.queryByText('EXPORT')).toBeNull()
  })
})
