// @vitest-environment jsdom
//
// A5 Task 24: SSE-aware PillarAnalysisButtonClient. This is a simple
// useState poller (no memo-poller-machine involved) that stops its bounded
// interval once status is 'complete'/'error'. SSE adds an unconditional
// (mount-scoped) subscription to pillar-analysis:<sessionId> — the button
// can transition again on a regenerate — plus a health-gated cadence on the
// bounded interval (1.5s fast / 20s safety once healthy).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

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

import { PillarAnalysisButtonClient } from './PillarAnalysisButtonClient';

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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const SESSION_ID = 'sess-btn-1';

describe('PillarAnalysisButtonClient', () => {
  it('renders the pending state when there is no record yet', () => {
    render(<PillarAnalysisButtonClient sessionId={SESSION_ID} initial={null} />);
    expect(screen.getByText(/Pillar: Pending/i)).toBeTruthy();
  });

  it('renders the link when complete', () => {
    render(
      <PillarAnalysisButtonClient
        sessionId={SESSION_ID}
        initial={{ id: 'pa1', status: 'complete', error: null }}
      />,
    );
    expect(screen.getByRole('link', { name: /Pillar Analysis/i })).toBeTruthy();
  });
});

describe('PillarAnalysisButtonClient — SSE-aware poll (A5 Task 24)', () => {
  it('subscribes to pillar-analysis:<sessionId>', () => {
    render(
      <PillarAnalysisButtonClient
        sessionId={SESSION_ID}
        initial={{ id: 'pa1', status: 'running', error: null }}
      />,
    );
    expect(__lastTopic()).toBe('pillar-analysis:sess-btn-1');
  });

  it('an invalidate push triggers an immediate refetch', async () => {
    let phase = 0;
    fetchMock.mockImplementation(async () =>
      jsonResponse({ pillarAnalysis: { id: 'pa1', status: phase === 0 ? 'running' : 'complete', error: null } }),
    );
    render(
      <PillarAnalysisButtonClient
        sessionId={SESSION_ID}
        initial={{ id: 'pa1', status: 'running', error: null }}
      />,
    );
    await act(async () => {
      await flushAsync();
    });
    expect(screen.queryByRole('link', { name: /Pillar Analysis/i })).toBeNull();

    phase = 1;
    await act(async () => {
      __fire();
      await flushAsync();
    });

    expect(screen.getByRole('link', { name: /Pillar Analysis/i })).toBeTruthy();
  });

  it('stays subscribed even after status is complete (a regenerate can transition it again)', async () => {
    render(
      <PillarAnalysisButtonClient
        sessionId={SESSION_ID}
        initial={{ id: 'pa1', status: 'complete', error: null }}
      />,
    );
    expect(__lastTopic()).toBe('pillar-analysis:sess-btn-1');
  });

  it('polls at the original 1.5s cadence while SSE is unhealthy (bounded — status running)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pillarAnalysis: { id: 'pa1', status: 'running', error: null } }));
    render(
      <PillarAnalysisButtonClient
        sessionId={SESSION_ID}
        initial={{ id: 'pa1', status: 'running', error: null }}
      />,
    );
    await act(async () => {
      await flushAsync();
    });
    const callsBefore = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('demotes to the 20s safety cadence once SSE is healthy, and re-arms fast on drop', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pillarAnalysis: { id: 'pa1', status: 'running', error: null } }));
    render(
      <PillarAnalysisButtonClient
        sessionId={SESSION_ID}
        initial={{ id: 'pa1', status: 'running', error: null }}
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
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAtHealthy);
  });

  it('stops the bounded interval once status is complete (no more polling, only the SSE sub remains)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pillarAnalysis: { id: 'pa1', status: 'complete', error: null } }));
    render(
      <PillarAnalysisButtonClient
        sessionId={SESSION_ID}
        initial={{ id: 'pa1', status: 'complete', error: null }}
      />,
    );
    const callsBefore = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
