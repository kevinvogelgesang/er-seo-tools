// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const searchMock = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchMock.params,
  useRouter: () => ({ push: vi.fn() }),
}))

import RobotsValidatorPage from './page'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('robots-validator ?url= auto-run', () => {
  it('fetches the robots.txt for the url param on mount', async () => {
    searchMock.params = new URLSearchParams('url=https%3A%2F%2Fexample.com')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: 'User-agent: *\nDisallow:' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<RobotsValidatorPage />)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/fetch-url?url=')),
    )
    expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent('https://example.com'))
  })

  it('does not auto-fetch when no url param is present', async () => {
    searchMock.params = new URLSearchParams()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<RobotsValidatorPage />)
    // give any mount effect a tick
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
