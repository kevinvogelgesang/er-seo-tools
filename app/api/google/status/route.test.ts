// app/api/google/status/route.test.ts
//
// Tests for GET /api/google/status.
// Mocks getServiceAccountEmail + getAuthClient from auth.ts
// and the googleapis google object for GA4 Admin + GSC calls.
// Does NOT touch prisma/DB.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/analytics/google/auth', () => ({
  getServiceAccountEmail: vi.fn(),
  getAuthClient: vi.fn(),
}))

vi.mock('googleapis', () => {
  const mockListGA4 = vi.fn()
  const mockListGSC = vi.fn()
  return {
    google: {
      analyticsadmin: vi.fn(() => ({
        accountSummaries: { list: mockListGA4 },
      })),
      searchconsole: vi.fn(() => ({
        sites: { list: mockListGSC },
      })),
      auth: {
        GoogleAuth: vi.fn(),
      },
      __mockListGA4: mockListGA4,
      __mockListGSC: mockListGSC,
    },
  }
})

const { getServiceAccountEmail, getAuthClient } = await import('@/lib/analytics/google/auth')
const { google } = await import('googleapis')
const { GET } = await import('./route')

// Helper to access inner mocks
const mocks = google as unknown as {
  __mockListGA4: ReturnType<typeof vi.fn>
  __mockListGSC: ReturnType<typeof vi.fn>
}

function makeRequest(url = 'http://localhost/api/google/status') {
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/google/status', () => {
  describe('key missing', () => {
    it('returns loaded=false, email=null when key is missing', async () => {
      vi.mocked(getServiceAccountEmail).mockResolvedValue(null)
      vi.mocked(getAuthClient).mockResolvedValue({
        ok: false,
        reason: 'auth',
        message: 'GOOGLE_SA_KEY_FILE env var is not set',
      })

      const res = await GET(makeRequest())
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.loaded).toBe(false)
      expect(body.email).toBeNull()
      // no ga4Count/gscCount when not loaded
      expect(body.ga4Count).toBeUndefined()
      expect(body.gscCount).toBeUndefined()
    })

    it('does not call GA4/GSC APIs when key is missing', async () => {
      vi.mocked(getServiceAccountEmail).mockResolvedValue(null)
      vi.mocked(getAuthClient).mockResolvedValue({ ok: false, reason: 'auth', message: 'missing' })

      await GET(makeRequest('http://localhost/api/google/status?test=1'))

      expect(mocks.__mockListGA4).not.toHaveBeenCalled()
      expect(mocks.__mockListGSC).not.toHaveBeenCalled()
    })
  })

  describe('key loaded, no test param', () => {
    it('returns loaded=true but withholds email + counts when ?test not set', async () => {
      vi.mocked(getServiceAccountEmail).mockResolvedValue('sa@project.iam.gserviceaccount.com')
      vi.mocked(getAuthClient).mockResolvedValue({
        ok: true,
        auth: {} as never,
      })

      const res = await GET(makeRequest())
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.loaded).toBe(true)
      // Email is gated behind the explicit connection test — the passive poll
      // must not leak the service-account address.
      expect(body.email).toBeNull()
      expect(getServiceAccountEmail).not.toHaveBeenCalled()
      expect(body.ga4Count).toBeUndefined()
      expect(body.gscCount).toBeUndefined()
    })
  })

  describe('test=1 live counts', () => {
    it('returns ga4Count + gscCount from API responses', async () => {
      vi.mocked(getServiceAccountEmail).mockResolvedValue('sa@project.iam.gserviceaccount.com')
      vi.mocked(getAuthClient).mockResolvedValue({ ok: true, auth: {} as never })

      mocks.__mockListGA4.mockResolvedValue({
        data: {
          accountSummaries: [
            { propertySummaries: [{ property: 'properties/111' }, { property: 'properties/222' }] },
            { propertySummaries: [{ property: 'properties/333' }] },
          ],
        },
      })
      mocks.__mockListGSC.mockResolvedValue({
        data: {
          siteEntry: [
            { siteUrl: 'sc-domain:example.com' },
            { siteUrl: 'https://other.com/' },
          ],
        },
      })

      const res = await GET(makeRequest('http://localhost/api/google/status?test=1'))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.loaded).toBe(true)
      // The explicit connection test is allowed to surface the SA email.
      expect(body.email).toBe('sa@project.iam.gserviceaccount.com')
      expect(body.ga4Count).toBe(3)
      expect(body.gscCount).toBe(2)
      expect(body.errors).toBeUndefined()
    })

    it('includes error list when GA4 call throws', async () => {
      vi.mocked(getServiceAccountEmail).mockResolvedValue('sa@project.iam.gserviceaccount.com')
      vi.mocked(getAuthClient).mockResolvedValue({ ok: true, auth: {} as never })

      mocks.__mockListGA4.mockRejectedValue(new Error('GA4 API unavailable'))
      mocks.__mockListGSC.mockResolvedValue({ data: { siteEntry: [{ siteUrl: 'sc-domain:x.com' }] } })

      const res = await GET(makeRequest('http://localhost/api/google/status?test=1'))
      const body = await res.json()

      expect(body.ga4Count).toBe(0)
      expect(body.gscCount).toBe(1)
      expect(body.errors).toContain('ga4')
    })
  })
})
