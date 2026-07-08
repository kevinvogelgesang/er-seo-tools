// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
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
    expect(link.getAttribute('href')).toBe('/seo-parser/results/run/run9');
  });
});
