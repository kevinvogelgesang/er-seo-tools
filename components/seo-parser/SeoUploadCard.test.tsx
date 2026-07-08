// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, afterEach, it, expect, vi } from 'vitest';

// NOTE: this repo has NO jest-dom matchers — assert on element.getAttribute(...)/.toBeTruthy(), not toHaveAttribute/toBeInTheDocument.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Stub FileDropzone with a button that fires onDrop with a fake File, so we
// can drive handleDrop without exercising react-dropzone in jsdom.
vi.mock('@/components/seo-parser/FileDropzone', () => ({
  FileDropzone: ({ onDrop }: { onDrop: (files: File[]) => void }) => (
    <button
      type="button"
      onClick={() => onDrop([new File(['a'], 'internal_all.csv', { type: 'text/csv' })])}
    >
      drop-file
    </button>
  ),
}));

import { SeoUploadCard } from './SeoUploadCard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SeoUploadCard', () => {
  it('shows no Analyze button until a file has been uploaded', () => {
    render(<SeoUploadCard />);
    expect(screen.getByText(/upload csv files/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /analyze/i })).toBeNull();
  });

  it('enables Analyze once a core file is uploaded (coreMissing empty), and posts to /api/upload + /api/parse/:id on click', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 'sess1', files: ['internal_all.csv'] }),
      }) // POST /api/upload
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sessionId: 'sess1', files: ['response_codes_all.csv'] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // POST /api/parse/:id
    vi.stubGlobal('fetch', fetchMock);

    render(<SeoUploadCard />);

    fireEvent.click(screen.getByText('drop-file'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/upload', expect.objectContaining({ method: 'POST' })));

    // internal_all.csv alone still leaves response_codes missing — coreMissing
    // gate should keep Analyze disabled.
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /analyze/i });
      expect(btn.getAttribute('disabled')).not.toBeNull();
    });

    // Drop again to supply the second core export.
    fireEvent.click(screen.getByText('drop-file'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    let analyzeBtn: HTMLElement;
    await waitFor(() => {
      analyzeBtn = screen.getByRole('button', { name: /analyze/i });
      expect(analyzeBtn.getAttribute('disabled')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/parse/sess1', expect.objectContaining({ method: 'POST' }))
    );
  });

  it('renders the "Compare two crawls" link pointing at /seo-audits/diff', () => {
    render(<SeoUploadCard />);
    const link = screen.getByRole('link', { name: /compare two crawls/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/seo-audits/diff');
  });
});
