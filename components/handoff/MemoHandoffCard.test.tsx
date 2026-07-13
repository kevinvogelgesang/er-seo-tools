// @vitest-environment jsdom
//
// D1 PR3 Task 13 — contract tests for the shared MemoHandoffCard. Verifies
// the card renders the caller-supplied emptyState/renderMemo/expired-restart
// wiring correctly and that it fetches the given pollUrl on each tick.
// SeoRoadmapCard.test.tsx / KeywordMemoCard.test.tsx remain the FROZEN gates
// proving the wrapper conversion preserved behavior — this file only tests
// the shared shell itself. Mocking convention mirrors those two suites.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

vi.mock('@/lib/events/client', () => {
  let invalidate: () => void = () => {};
  let health: (h: boolean) => void = () => {};
  return {
    subscribeTopic: (_topic: string, cb: () => void) => {
      invalidate = cb;
      return () => {};
    },
    subscribeHealth: (cb: (h: boolean) => void) => {
      health = cb;
      cb(false);
      return () => {};
    },
    __fire: () => invalidate(),
    __setHealth: (h: boolean) => health(h),
  };
});
import * as eventsClient from '@/lib/events/client';
const { __setHealth } = eventsClient as unknown as {
  __fire: () => void;
  __setHealth: (h: boolean) => void;
};

import { MemoHandoffCard } from './MemoHandoffCard';

async function flushAsync(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  refreshMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const SESSION_ID = 'sess-shared-1';
const POLL_URL = '/api/fake-memo/by-session/sess-shared-1';

const baseProps = {
  sessionId: SESSION_ID,
  pollUrl: POLL_URL,
  extractUpdatedAt: (body: unknown) => (body as { updatedAt?: string | null })?.updatedAt ?? null,
  title: 'Fake Memo',
  headerButton: <button type="button">Generate</button>,
  renderMemo: (markdown: string) => <div data-testid="rendered-memo">{markdown}</div>,
  emptyState: <p>No fake memo yet</p>,
  sectionId: 'fake-memo',
  expiredCta: 'Check for fake memo',
};

describe('MemoHandoffCard', () => {
  it('renders the emptyState when there is no markdown', () => {
    render(
      <MemoHandoffCard
        {...baseProps}
        initialStatus="pending"
        initialMarkdown={null}
        initialUpdatedAt={null}
        initialTokenMintedAt={null}
      />,
    );
    expect(screen.getByText('No fake memo yet')).toBeTruthy();
  });

  it('renders the memo via renderMemo when markdown is present', () => {
    render(
      <MemoHandoffCard
        {...baseProps}
        initialStatus="complete"
        initialMarkdown="## Hello"
        initialUpdatedAt={'2026-07-01T00:00:00Z'}
        initialTokenMintedAt={null}
      />,
    );
    expect(screen.getByTestId('rendered-memo').textContent).toBe('## Hello');
    expect(screen.queryByText('No fake memo yet')).toBeNull();
  });

  it('shows the expired banner after the poll window elapses and restart clears it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ updatedAt: null }));
    render(
      <MemoHandoffCard
        {...baseProps}
        initialStatus="processing"
        initialMarkdown={null}
        initialUpdatedAt={null}
        initialTokenMintedAt={new Date().toISOString()}
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    // Drive the poll loop past the 15-minute lifetime cap.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 5000);
      await flushAsync();
    });

    expect(screen.getByText(/Stopped checking after 15 minutes/i)).toBeTruthy();

    const restartButton = screen.getByText('Check for fake memo');
    await act(async () => {
      restartButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });

    expect(screen.queryByText(/Stopped checking after 15 minutes/i)).toBeNull();
  });

  it('fetches the given pollUrl on tick', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ updatedAt: null }));
    render(
      <MemoHandoffCard
        {...baseProps}
        initialStatus="processing"
        initialMarkdown={null}
        initialUpdatedAt={null}
        initialTokenMintedAt={new Date().toISOString()}
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    await act(async () => {
      __setHealth(false);
      await vi.advanceTimersByTimeAsync(3000);
      await flushAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith(POLL_URL);
  });
});
