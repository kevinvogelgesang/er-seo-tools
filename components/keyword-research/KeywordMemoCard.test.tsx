// @vitest-environment jsdom
//
// A5 Task 24: SSE-aware KeywordMemoCard — sibling of SeoRoadmapCard.test.tsx.
// The bounded poll semantics (auto-start only on initialStatus==='processing',
// 15-min active-time cap, visibility pause via the shared memo-poller-machine)
// are preserved unchanged; SSE adds an immediate router.refresh() via
// machine.invalidate() on a memo:<sessionId> push, plus a health-gated
// cadence (3s fast / 20s safety once healthy).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

vi.mock('@/lib/events/client', () => {
  let invalidate: () => void = () => {};
  let health: (h: boolean) => void = () => {};
  let lastTopic: string | undefined;
  return {
    subscribeTopic: (topic: string, cb: () => void) => {
      lastTopic = topic;
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
    __lastTopic: () => lastTopic,
  };
});
import * as eventsClient from '@/lib/events/client';
const { __fire, __setHealth, __lastTopic } = eventsClient as unknown as {
  __fire: () => void;
  __setHealth: (h: boolean) => void;
  __lastTopic: () => string | undefined;
};

import { KeywordMemoCard } from './KeywordMemoCard';

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

const SESSION_ID = 'sess-kw-1';

describe('KeywordMemoCard', () => {
  it('renders the empty state when there is no memo yet', () => {
    render(
      <KeywordMemoCard
        sessionId={SESSION_ID}
        initialStatus="pending"
        initialMemoMarkdown={null}
        initialMemoUpdatedAt={null}
        initialTokenMintedAt={null}
      />,
    );
    expect(screen.getByText(/No keyword memo yet/i)).toBeTruthy();
  });

  it('renders the memo markdown when present', () => {
    render(
      <KeywordMemoCard
        sessionId={SESSION_ID}
        initialStatus="complete"
        initialMemoMarkdown={'## Keyword Strategy'}
        initialMemoUpdatedAt={'2026-07-01T00:00:00Z'}
        initialTokenMintedAt={null}
      />,
    );
    expect(screen.getByText('Keyword Strategy')).toBeTruthy();
  });
});

describe('KeywordMemoCard — SSE-aware poll (A5 Task 24)', () => {
  it('subscribes to memo:<sessionId>', () => {
    render(
      <KeywordMemoCard
        sessionId={SESSION_ID}
        initialStatus="pending"
        initialMemoMarkdown={null}
        initialMemoUpdatedAt={null}
        initialTokenMintedAt={null}
      />,
    );
    expect(__lastTopic()).toBe('memo:sess-kw-1');
  });

  it('an invalidate push while auto-started calls router.refresh() via machine.invalidate()', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ keywordResearch: { memoUpdatedAt: null } }));
    render(
      <KeywordMemoCard
        sessionId={SESSION_ID}
        initialStatus="processing"
        initialMemoMarkdown={null}
        initialMemoUpdatedAt={null}
        initialTokenMintedAt={new Date().toISOString()}
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    await act(async () => {
      __fire();
      await flushAsync();
    });

    expect(refreshMock).toHaveBeenCalled();
  });

  it('polls at the original 3s cadence while SSE is unhealthy', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ keywordResearch: { memoUpdatedAt: null } }));
    render(
      <KeywordMemoCard
        sessionId={SESSION_ID}
        initialStatus="processing"
        initialMemoMarkdown={null}
        initialMemoUpdatedAt={null}
        initialTokenMintedAt={new Date().toISOString()}
      />,
    );
    await act(async () => {
      await flushAsync();
    });
    const callsBefore = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('demotes to the 20s safety cadence once SSE is healthy, and re-arms fast on drop', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ keywordResearch: { memoUpdatedAt: null } }));
    render(
      <KeywordMemoCard
        sessionId={SESSION_ID}
        initialStatus="processing"
        initialMemoMarkdown={null}
        initialMemoUpdatedAt={null}
        initialTokenMintedAt={new Date().toISOString()}
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    await act(async () => {
      __setHealth(true);
      await flushAsync();
    });
    const callsAtHealthy = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock.mock.calls.length).toBe(callsAtHealthy);

    await act(async () => {
      __setHealth(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAtHealthy);
  });
});
