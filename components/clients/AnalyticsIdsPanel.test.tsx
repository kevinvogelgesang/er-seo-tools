// @vitest-environment jsdom
// components/clients/AnalyticsIdsPanel.test.tsx
// Covers the searchable GA4/GSC comboboxes (type-to-filter).
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnalyticsIdsPanel } from './AnalyticsIdsPanel'

const GA4_PROPS = [
  { propertyId: 111, displayName: 'Acme University' },
  { propertyId: 222, displayName: 'Beta College' },
]
const GSC_SITES = [{ siteUrl: 'sc-domain:acme.edu' }, { siteUrl: 'https://beta.edu/' }]

function mockFetch() {
  return vi.fn((url: string) => {
    if (url.includes('/analytics')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ga4PropertyId: null, gscSiteUrl: null, crmClientRef: null }),
      })
    }
    if (url.includes('/google/properties')) {
      return Promise.resolve({ ok: true, json: async () => GA4_PROPS })
    }
    if (url.includes('/google/gsc-sites')) {
      return Promise.resolve({ ok: true, json: async () => GSC_SITES })
    }
    return Promise.resolve({ ok: false, json: async () => ({}) })
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AnalyticsIdsPanel searchable selects', () => {
  it('filters GA4 options by typed query (name or id)', async () => {
    render(<AnalyticsIdsPanel clientId={1} />)

    // Two "not mapped" triggers (GA4 first, GSC second). Open the GA4 one.
    const triggers = await screen.findAllByText('— not mapped —')
    fireEvent.click(triggers[0])

    // Both options visible once the props list has loaded.
    expect(await screen.findByText('Acme University (111)')).toBeTruthy()
    expect(screen.getByText('Beta College (222)')).toBeTruthy()

    // Typing filters the list.
    const search = screen.getByPlaceholderText('Search by name or property id…')
    fireEvent.change(search, { target: { value: 'beta' } })
    expect(screen.getByText('Beta College (222)')).toBeTruthy()
    expect(screen.queryByText('Acme University (111)')).toBeNull()

    // Filtering by numeric id also works.
    fireEvent.change(search, { target: { value: '111' } })
    expect(screen.getByText('Acme University (111)')).toBeTruthy()
    expect(screen.queryByText('Beta College (222)')).toBeNull()

    // No-match state.
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText('No matches')).toBeTruthy()
  })

  it('selecting an option closes the popover and shows it on the trigger', async () => {
    render(<AnalyticsIdsPanel clientId={1} />)
    const triggers = await screen.findAllByText('— not mapped —')
    fireEvent.click(triggers[0])

    fireEvent.click(await screen.findByText('Acme University (111)'))

    // Popover closed → search box gone; trigger now shows the selection.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Search by name or property id…')).toBeNull(),
    )
    expect(screen.getByText('Acme University (111)')).toBeTruthy()
  })
})
