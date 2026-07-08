// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'
import DashboardQueueStatus from './DashboardQueueStatus'

afterEach(() => cleanup())

describe('DashboardQueueStatus (C11 PR 2a IntentChip)', () => {
  it('queued list shows the SEO chip for a seoOnly item and none for the ADA item', () => {
    const queueStatus: QueueStatusWithBatch = {
      active: null,
      queued: [
        { id: 'q1', domain: 'seo-only.com', position: 1, clientId: null, seoOnly: true },
        { id: 'q2', domain: 'ada.com', position: 2, clientId: null, seoOnly: false },
      ],
      batch: null,
    }
    render(<DashboardQueueStatus queueStatus={queueStatus} />)
    expect(screen.getAllByText('SEO').length).toBe(1)
  })

  it('active card shows the SEO chip for a seoOnly active audit', () => {
    const queueStatus: QueueStatusWithBatch = {
      active: {
        id: 'a1',
        domain: 'active-seo.com',
        status: 'running',
        pagesTotal: 10,
        pagesComplete: 3,
        pagesError: 0,
        pdfsTotal: 0,
        pdfsComplete: 0,
        pdfsError: 0,
        pdfsSkipped: 0,
        lighthouseTotal: 0,
        lighthouseComplete: 0,
        lighthouseError: 0,
        clientId: null,
        seoOnly: true,
      },
      queued: [],
      batch: null,
    }
    render(<DashboardQueueStatus queueStatus={queueStatus} />)
    expect(screen.getAllByText('SEO').length).toBe(1)
  })
})
