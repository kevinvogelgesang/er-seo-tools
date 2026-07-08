// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, afterEach, beforeEach, it, expect, vi } from 'vitest';
import { SeoScanForm } from './SeoScanForm';

// NOTE: this repo has NO jest-dom matchers — assert on element.getAttribute(...), not toHaveAttribute.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    sessionStorage.clear();
  } catch {}
});

it('C11: submits seoOnly and advances to a ready link when liveScanRunId arrives', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ status: 202, json: async () => ({ id: 'sa1', status: 'queued' }) }) // POST
    .mockResolvedValue({ ok: true, json: async () => ({ status: 'complete', liveScanRunId: 'run9' }) }); // subsequent polls: ready
  vi.stubGlobal('fetch', fetchMock);

  render(<SeoScanForm />);
  fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'example.edu' } });
  fireEvent.click(screen.getByRole('button', { name: /scan/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/site-audit', expect.objectContaining({ method: 'POST' }))
  );
  const postBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  expect(postBody.seoOnly).toBe(true);
  expect(postBody.domain).toBe('example.edu');

  await waitFor(() => {
    const link = screen.getByRole('link', { name: /view|result/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/seo-audits/results/run/run9');
  });
});

describe('SeoScanForm terminal + handoff (C11 PR 2a)', () => {
  beforeEach(() => { sessionStorage.clear(); window.history.pushState({}, '', '/seo-audits') })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('adopts ?scan= and polls it, overriding stale sessionStorage', async () => {
    sessionStorage.setItem('seo-scan-id', 'OLD')
    window.history.pushState({}, '', '/seo-audits?scan=NEW')
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/api/site-audit/NEW')   // must poll NEW, never OLD
      return { ok: true, json: async () => ({ status: 'running' }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SeoScanForm />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(sessionStorage.getItem('seo-scan-id')).toBe('NEW')
  })

  it('strips ?scan= from the URL after adoption', async () => {
    window.history.pushState({}, '', '/seo-audits?scan=NEW')
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'running' }) } as Response))
    vi.stubGlobal('fetch', fetchMock)
    render(<SeoScanForm />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/site-audit/NEW'))
    expect(window.location.search).toBe('')
  })

  it('shows a terminal error on status:error and stops polling + clears storage', async () => {
    sessionStorage.setItem('seo-scan-id', 'X')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'error' }) } as Response)))
    render(<SeoScanForm />)
    await waitFor(() => expect(screen.getByText(/SEO scan failed/i)).toBeTruthy())
    expect(sessionStorage.getItem('seo-scan-id')).toBeNull()
  })

  it('treats status:cancelled as terminal error', async () => {
    sessionStorage.setItem('seo-scan-id', 'X')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'cancelled' }) } as Response)))
    render(<SeoScanForm />)
    await waitFor(() => expect(screen.getByText(/SEO scan failed/i)).toBeTruthy())
  })

  it('treats a 404 poll as terminal error', async () => {
    sessionStorage.setItem('seo-scan-id', 'X')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) } as Response)))
    render(<SeoScanForm />)
    await waitFor(() => expect(screen.getByText(/SEO scan failed/i)).toBeTruthy())
  })
})

describe('SeoScanForm — seoPhase-driven progress (C11 PR 2b)', () => {
  beforeEach(() => { sessionStorage.clear(); window.history.pushState({}, '', '/seo-audits') })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('renders progress bar + message while SEO analysis is running', async () => {
    sessionStorage.setItem('seo-scan-id', 'X')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'complete', liveScanRunId: null, seoPhase: { state: 'running', progress: 60, message: 'Checked 6/10 links' } }),
    } as Response)))
    render(<SeoScanForm />)
    expect(await screen.findByText(/Checked 6\/10 links/)).toBeTruthy()
    expect(screen.getByText(/Building SEO report/i)).toBeTruthy()
  })

  it('treats seoPhase failed as terminal and clears sessionStorage', async () => {
    sessionStorage.setItem('seo-scan-id', 'X')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'complete', liveScanRunId: null, seoPhase: { state: 'failed', progress: null, message: null } }),
    } as Response)))
    render(<SeoScanForm />)
    expect(await screen.findByText(/SEO analysis failed/i)).toBeTruthy()
    expect(sessionStorage.getItem('seo-scan-id')).toBeNull()
  })

  it('treats seoPhase unavailable as a terminal state', async () => {
    sessionStorage.setItem('seo-scan-id', 'X')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'complete', liveScanRunId: null, seoPhase: { state: 'unavailable', progress: null, message: null } }),
    } as Response)))
    render(<SeoScanForm />)
    expect(await screen.findByText(/unavailable/i)).toBeTruthy()
    expect(sessionStorage.getItem('seo-scan-id')).toBeNull()
  })

  it('readiness is keyed on liveScanRunId, not seoPhase.state', async () => {
    sessionStorage.setItem('seo-scan-id', 'X')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'complete', liveScanRunId: 'run1', seoPhase: { state: 'running', progress: 99, message: 'almost' } }),
    } as Response)))
    render(<SeoScanForm />)
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /view|result/i }) as HTMLAnchorElement
      expect(link.getAttribute('href')).toBe('/seo-audits/results/run/run1')
    })
  })
})
