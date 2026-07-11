// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { KeywordStrategyCard } from './KeywordStrategyCard';

const readiness = { gscMapped: true, hasLiveScan: true, hasLocale: true };

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mockFetch = (impl: (url: string, init?: RequestInit) => { status: number; body: unknown }) => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
    const { status, body } = impl(String(url), init);
    return new Response(JSON.stringify(body), { status });
  });
};

const session = (over: Partial<{ id: string; status: string; tokenMintedAt: string | null; memoMarkdown: string | null; memoUpdatedAt: string | null }> = {}) => ({
  id: 's1',
  status: 'complete',
  tokenMintedAt: null,
  memoMarkdown: null,
  memoUpdatedAt: null,
  ...over,
});

describe('KeywordStrategyCard', () => {
  it('renders the latest memo markdown and an Updated line', () => {
    render(
      <KeywordStrategyCard
        clientId={1}
        initialSession={session({ memoMarkdown: '# Strategy heading', memoUpdatedAt: '2026-07-11T00:00:00Z' })}
        readiness={readiness}
        archived={false}
      />,
    );
    expect(screen.getByText('Strategy heading')).toBeTruthy();
    expect(screen.getByText(/Updated/i)).toBeTruthy();
  });

  it('renders an empty state when there is no session', () => {
    render(<KeywordStrategyCard clientId={1} initialSession={null} readiness={readiness} archived={false} />);
    expect(screen.getByText(/No keyword strategy yet/i)).toBeTruthy();
  });

  it('mint flow: POSTs mint, writes the composed payload to the clipboard, enters copied state', async () => {
    const calls: { method: string; url: string }[] = [];
    mockFetch((url, init) => {
      calls.push({ method: init?.method ?? 'GET', url });
      if (url.endsWith('/mint-token')) return { status: 200, body: { token: 'kst_tok123', strategyId: 'sid9' } };
      return { status: 200, body: { session: null } };
    });
    render(<KeywordStrategyCard clientId={7} initialSession={null} readiness={readiness} archived={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate strategy prompt/i }));
    });

    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/clients/7/keyword-strategy/mint-token'))).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).toContain('Strategy ID: sid9');
    expect(payload).toContain('Access token: kst_tok123');
    expect(screen.getAllByRole('button', { name: /copied/i }).length).toBeGreaterThan(0);
  });

  it('polling detects a memoUpdatedAt change and renders the new memo', async () => {
    vi.useFakeTimers();
    let phase = 0;
    mockFetch((url, init) => {
      if (url.endsWith('/mint-token')) return { status: 200, body: { token: 'kst_x', strategyId: 'sid' } };
      // GET poll
      if (phase === 0) return { status: 200, body: { session: session({ status: 'processing', memoUpdatedAt: null }) } };
      return {
        status: 200,
        body: { session: session({ status: 'complete', memoMarkdown: '# Fresh memo body', memoUpdatedAt: '2026-07-11T01:00:00Z' }) },
      };
    });
    render(<KeywordStrategyCard clientId={3} initialSession={null} readiness={readiness} archived={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate strategy prompt/i }));
    });

    // First poll: no change yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    // Flip the backend to the new memo, then poll again.
    phase = 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText('Fresh memo body')).toBeTruthy();
  });

  it('regenerate over an EXISTING memo: first poll returns the new empty row without wiping the memo or killing the poll; the new memo renders when posted back', async () => {
    vi.useFakeTimers();
    let phase = 0;
    mockFetch((url, init) => {
      if (url.endsWith('/mint-token') && init?.method === 'POST') {
        return { status: 200, body: { token: 'kst_re', strategyId: 'sid-new' } };
      }
      // GET poll: the mint created a NEW latest session row with null memo
      // fields; the old memo lives on the previous row and is no longer
      // returned by latest-session resolution.
      if (phase === 0) {
        return { status: 200, body: { session: session({ id: 's2', status: 'processing', memoMarkdown: null, memoUpdatedAt: null }) } };
      }
      return {
        status: 200,
        body: { session: session({ id: 's2', status: 'complete', memoMarkdown: '# Regenerated memo body', memoUpdatedAt: '2026-07-11T02:00:00Z' }) },
      };
    });

    render(
      <KeywordStrategyCard
        clientId={5}
        initialSession={session({ id: 's1', memoMarkdown: '# Old memo body', memoUpdatedAt: '2026-07-10T00:00:00Z' })}
        readiness={readiness}
        archived={false}
      />,
    );
    expect(screen.getByText('Old memo body')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate strategy prompt/i }));
    });

    // First tick fetches the fresh empty row: the poll must SURVIVE (baseline
    // anchored to the new row, not the old memo's date) and the old memo must
    // still be displayed — not wiped to the empty state.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText('Old memo body')).toBeTruthy();
    expect(screen.queryByText(/No keyword strategy yet/i)).toBeNull();

    // The skill posts back; the next tick must pick up the NEW memo.
    phase = 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText('Regenerated memo body')).toBeTruthy();
    expect(screen.queryByText('Old memo body')).toBeNull();
  });

  it('shows readiness hints when flags are false and hides them when true', () => {
    const { unmount } = render(
      <KeywordStrategyCard
        clientId={1}
        initialSession={null}
        readiness={{ gscMapped: false, hasLiveScan: false, hasLocale: false }}
        archived={false}
      />,
    );
    expect(screen.getByText(/No GSC mapping/i)).toBeTruthy();
    expect(screen.getByText(/No live scan yet/i)).toBeTruthy();
    expect(screen.getByText(/No locale set/i)).toBeTruthy();
    unmount();

    render(<KeywordStrategyCard clientId={1} initialSession={null} readiness={readiness} archived={false} />);
    expect(screen.queryByText(/No GSC mapping/i)).toBeNull();
    expect(screen.queryByText(/No live scan yet/i)).toBeNull();
    expect(screen.queryByText(/No locale set/i)).toBeNull();
  });

  it('disables the button when the client is archived', () => {
    render(<KeywordStrategyCard clientId={1} initialSession={null} readiness={readiness} archived={true} />);
    const btn = screen.getByRole('button', { name: /generate strategy prompt/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('mint 500 → error state, no clipboard write', async () => {
    mockFetch((url) => {
      if (url.endsWith('/mint-token')) return { status: 500, body: { error: 'internal_error' } };
      return { status: 200, body: { session: null } };
    });
    render(<KeywordStrategyCard clientId={1} initialSession={null} readiness={readiness} archived={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate strategy prompt/i }));
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: /failed|error|retry/i }).length).toBeGreaterThan(0);
  });
});
