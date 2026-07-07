// components/widgets/LiveNowWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const queueMock = vi.hoisted(() => ({ value: { data: null as any, error: false, loading: false } }))
vi.mock('@/lib/widgets/queue-poll', () => ({ useQueueStatus: () => queueMock.value }))

import { LiveNowWidget } from './LiveNowWidget'

afterEach(cleanup)

describe('LiveNowWidget', () => {
  it('shows an idle state when nothing is running or queued', () => {
    queueMock.value = { data: { active: null, queued: [], batch: null }, error: false, loading: false }
    render(<LiveNowWidget size="lg" />)
    expect(screen.getByText(/no scans running/i)).toBeTruthy()
  })

  it('renders the active audit domain and progress', () => {
    queueMock.value = {
      data: {
        active: { id: 'a1', domain: 'example.com', status: 'running', pagesTotal: 10, pagesComplete: 4, pagesError: 0, pdfsTotal: 0, pdfsComplete: 0, pdfsError: 0, pdfsSkipped: 0, lighthouseTotal: 0, lighthouseComplete: 0, lighthouseError: 0, clientId: null },
        queued: [{ id: 'q1', domain: 'two.com', position: 1, clientId: null }],
        batch: null,
      },
      error: false, loading: false,
    }
    render(<LiveNowWidget size="lg" />)
    expect(screen.getByText('example.com')).toBeTruthy()
    expect(screen.getByText(/1 queued/i)).toBeTruthy()
  })

  it('renders a degraded note on fetch error with no prior data', () => {
    queueMock.value = { data: null, error: true, loading: false }
    render(<LiveNowWidget size="sm" />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })
})
