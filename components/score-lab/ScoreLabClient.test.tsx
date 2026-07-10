// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ScoreLabClient } from './ScoreLabClient'
import { DEFAULT_ADA_V4_WEIGHTS } from '@/lib/scoring/ada-v4'

const runs = [
  { id: 'run-ada-1', domain: 'example.com', tool: 'ada-audit', source: 'site-audit', score: 62, createdAt: '2026-07-01T00:00:00.000Z' },
  { id: 'run-seo-1', domain: 'client-site.com', tool: 'seo-parser', source: 'sf-upload', score: 80, createdAt: '2026-07-02T00:00:00.000Z' },
]

// Real AdaV4Inputs — the recompute under test is the actual computeAdaScoreV4.
const adaPayload = {
  kind: 'ada',
  inputs: {
    pagesAudited: 10, pagesTotal: 10, meanIncomplete: 0,
    rules: [
      { ruleId: 'image-alt', impact: 'critical', advisory: false, pagesAffected: 5 },
      { ruleId: 'link-name', impact: 'serious', advisory: false, pagesAffected: 8 },
    ],
  },
  current: { score: 62, version: 4, weightsHash: 'abc123def456', domain: 'example.com', tool: 'ada-audit', source: 'site-audit' },
}

const seoUnavailablePayload = {
  kind: 'unavailable',
  reason: 'what-if unavailable (scored before C19 — no inputs snapshot)',
  current: { score: 80, version: 1, weightsHash: null, domain: 'client-site.com', tool: 'seo-parser', source: 'sf-upload' },
}

const seoAvailablePayload = {
  kind: 'seo',
  scorer: 'health',
  snapshot: {
    source: 'sf', totalUrls: 100, indexableUrls: 90, clientErrors: 2, serverErrors: 1,
    base: 100, missingTitle: 5, missingMeta: 5, missingH1: 5,
    avgCrawlDepth: 2, thinCount: 3, pagesWithSchema: 80, indexableKnown: true, errorsKnown: true,
  },
  current: { score: 80, version: 2, weightsHash: 'seohash', domain: 'client-site.com', tool: 'seo-parser', source: 'sf-upload' },
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Default settings-endpoint responses shared by most tests (unused by the
// component beyond seeding initial slider state).
function defaultSettingsRoutes(url: string) {
  if (url.includes('/api/settings/ada-scoring-weights')) return jsonResponse({ weights: DEFAULT_ADA_V4_WEIGHTS })
  if (url.includes('/api/settings/scoring-weights')) return jsonResponse({ weights: null })
  return undefined
}

describe('ScoreLabClient', () => {
  it('renders the run list from ?list=1', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('lab-inputs?list=1')) return jsonResponse({ runs })
      return defaultSettingsRoutes(url) ?? jsonResponse({})
    })

    await act(async () => { render(<ScoreLabClient />) })

    expect(screen.getByText('example.com')).toBeTruthy()
    expect(screen.getByText('client-site.com')).toBeTruthy()
  })

  it('selecting an ada run renders current + what-if scores and six sliders; dragging Critical cap updates the what-if score', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('lab-inputs?list=1')) return jsonResponse({ runs })
      if (url.includes('lab-inputs?runId=run-ada-1')) return jsonResponse(adaPayload)
      return defaultSettingsRoutes(url) ?? jsonResponse({})
    })

    const { container } = render(<ScoreLabClient />)
    await act(async () => {})

    await act(async () => { fireEvent.click(screen.getByText('example.com')) })

    expect(screen.getByText('Current')).toBeTruthy()
    expect(screen.getByText('What-if')).toBeTruthy()
    expect(screen.getByText('62')).toBeTruthy() // stored current score

    const sliders = screen.getAllByRole('slider')
    expect(sliders.length).toBe(6)

    const whatIfBefore = container.querySelector('.text-orange-600')?.textContent

    const criticalSlider = screen.getByLabelText(/Critical cap/i)
    await act(async () => { fireEvent.change(criticalSlider, { target: { value: '80' } }) })

    const whatIfAfter = container.querySelector('.text-orange-600')?.textContent
    expect(whatIfAfter).not.toBe(whatIfBefore)
  })

  it('selecting a pre-C19 seo run (kind: unavailable) renders the reason copy', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('lab-inputs?list=1')) return jsonResponse({ runs })
      if (url.includes('lab-inputs?runId=run-seo-1')) return jsonResponse(seoUnavailablePayload)
      return defaultSettingsRoutes(url) ?? jsonResponse({})
    })

    render(<ScoreLabClient />)
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByText('client-site.com')) })

    expect(screen.getByText(seoUnavailablePayload.reason)).toBeTruthy()
  })

  it('"Save as ADA defaults" PUTs the current slider values to /api/settings/ada-scoring-weights', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('lab-inputs?list=1')) return jsonResponse({ runs })
      if (url.includes('lab-inputs?runId=run-ada-1')) return jsonResponse(adaPayload)
      if (url.includes('/api/settings/ada-scoring-weights') && init?.method === 'PUT') {
        return jsonResponse({ weights: JSON.parse(init.body as string) })
      }
      return defaultSettingsRoutes(url) ?? jsonResponse({})
    })

    render(<ScoreLabClient />)
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByText('example.com')) })

    await act(async () => { fireEvent.click(screen.getByText('Save as ADA defaults')) })

    const putCall = fetchMock.mock.calls.find(
      (c) => c[0] === '/api/settings/ada-scoring-weights' && c[1]?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    expect(JSON.parse(putCall![1].body as string)).toEqual(DEFAULT_ADA_V4_WEIGHTS)
    expect(screen.getByText(/ADA weights saved/)).toBeTruthy()
  })

  it('caps summing past 100 render a validation error and DISABLE the ADA save button', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('lab-inputs?list=1')) return jsonResponse({ runs })
      if (url.includes('lab-inputs?runId=run-ada-1')) return jsonResponse(adaPayload)
      return defaultSettingsRoutes(url) ?? jsonResponse({})
    })

    render(<ScoreLabClient />)
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByText('example.com')) })

    const criticalSlider = screen.getByLabelText(/Critical cap/i)
    await act(async () => { fireEvent.change(criticalSlider, { target: { value: '90' } }) })

    expect(screen.getByText(/must sum to at most 100/)).toBeTruthy()
    const saveButton = screen.getByText('Save as ADA defaults') as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
  })

  it('the what-if caption ("not the weights the run was scored with") renders with the ADA breakdown panel', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('lab-inputs?list=1')) return jsonResponse({ runs })
      if (url.includes('lab-inputs?runId=run-ada-1')) return jsonResponse(adaPayload)
      return defaultSettingsRoutes(url) ?? jsonResponse({})
    })

    render(<ScoreLabClient />)
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByText('example.com')) })

    expect(screen.getByText(/not the weights the run was scored with/)).toBeTruthy()
  })

  it('the what-if caption renders with the SEO breakdown panel too', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('lab-inputs?list=1')) return jsonResponse({ runs })
      if (url.includes('lab-inputs?runId=run-seo-1')) return jsonResponse(seoAvailablePayload)
      return defaultSettingsRoutes(url) ?? jsonResponse({})
    })

    render(<ScoreLabClient />)
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByText('client-site.com')) })

    expect(screen.getByText(/not the weights the run was scored with/)).toBeTruthy()
    expect(screen.getByText('Save as SEO defaults')).toBeTruthy()
  })

  it('the historical-scores banner copy is present', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('lab-inputs?list=1')) return jsonResponse({ runs })
      return defaultSettingsRoutes(url) ?? jsonResponse({})
    })

    render(<ScoreLabClient />)
    await act(async () => {})

    expect(screen.getAllByText(/Historical scores keep the weights they were scored with/).length).toBeGreaterThan(0)
  })
})
