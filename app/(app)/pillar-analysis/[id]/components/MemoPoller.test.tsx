// @vitest-environment jsdom
//
// A5 Task 24: SSE-aware MemoPoller — sibling of SeoRoadmapCard.test.tsx /
// KeywordMemoCard.test.tsx. Subscribes to memo:<sessionId ?? analysisId> so
// it mirrors the narrative PATCH route's own fallback (a live-scan/crawlRun
// -keyed PillarAnalysis has no session). Bounded poll semantics (auto-start
// only when autoStartOnMount, 15-min active-time cap, visibility pause via
// the shared memo-poller-machine) are preserved unchanged; SSE adds an
// immediate router.refresh() via machine.invalidate() plus a health-gated
// cadence (3s fast / 20s safety once healthy).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

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

import { MemoPoller } from './MemoPoller';

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

describe('MemoPoller — SSE-aware poll (A5 Task 24)', () => {
  it('subscribes to memo:<sessionId> when a sessionId is present', () => {
    render(
      <MemoPoller analysisId="pa1" sessionId="sess-1" initialNarrativeUpdatedAt={null} autoStartOnMount={false} />,
    );
    expect(__lastTopic()).toBe('memo:sess-1');
  });

  it('falls back to memo:<analysisId> when sessionId is null (live-scan analysis)', () => {
    render(
      <MemoPoller analysisId="pa1" sessionId={null} initialNarrativeUpdatedAt={null} autoStartOnMount={false} />,
    );
    expect(__lastTopic()).toBe('memo:pa1');
  });

  it('an invalidate push while auto-started calls router.refresh() via machine.invalidate()', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pillarAnalysis: { narrativeUpdatedAt: null } }));
    render(
      <MemoPoller analysisId="pa1" sessionId="sess-1" initialNarrativeUpdatedAt={null} autoStartOnMount={true} />,
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
    fetchMock.mockResolvedValue(jsonResponse({ pillarAnalysis: { narrativeUpdatedAt: null } }));
    render(
      <MemoPoller analysisId="pa1" sessionId="sess-1" initialNarrativeUpdatedAt={null} autoStartOnMount={true} />,
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
    fetchMock.mockResolvedValue(jsonResponse({ pillarAnalysis: { narrativeUpdatedAt: null } }));
    render(
      <MemoPoller analysisId="pa1" sessionId="sess-1" initialNarrativeUpdatedAt={null} autoStartOnMount={true} />,
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
