// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

// Stub all data/router deps so the grid renders without real fetches.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/widgets/queue-poll', () => ({ useQueueStatus: () => ({ data: { active: null, queued: [], batch: null }, error: false, loading: false }) }))

import { DashboardGrid } from './DashboardGrid'
import { WIDGETS } from '@/lib/widgets/registry'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('DashboardGrid', () => {
  it('renders a frame titled for every widget in the default layout', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    render(<DashboardGrid />)
    // Titles come from the registry; at least the fixed set should be present.
    for (const title of ['Live now', 'Start a site audit', 'Recent parses']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0)
    }
    // Sanity: registry has exactly the seven PR-2 widgets.
    expect(WIDGETS.length).toBe(7)
  })
})
