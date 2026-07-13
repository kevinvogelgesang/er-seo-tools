// @vitest-environment jsdom
//
// D1 PR3 Task 12 — contract tests for the extracted useMemoPoller hook. The
// hook must reproduce ALL FOUR source components' semantics exactly
// (SeoRoadmapCard, KeywordMemoCard, pillar-analysis MemoPoller,
// KeywordStrategyCard) through its opts, without bypassing the real
// lib/memo-poller-machine.ts state machine. Mocking convention mirrors
// SeoRoadmapCard.test.tsx / KeywordStrategyCard.test.tsx (A5 Task 24).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// vi.mock MUST precede the imports it mocks (hoisted by vitest anyway, but
// keeping it textually first matches house convention).
vi.mock('@/lib/events/client', () => {
  const topicHandlers = new Map<string, Set<() => void>>();
  let health: (h: boolean) => void = () => {};
  let healthSubscribeCount = 0;
  const subscribeLog: string[] = [];
  const unsubscribeLog: string[] = [];
  return {
    subscribeTopic: (topic: string, cb: () => void) => {
      subscribeLog.push(topic);
      let set = topicHandlers.get(topic);
      if (!set) {
        set = new Set();
        topicHandlers.set(topic, set);
      }
      set.add(cb);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        unsubscribeLog.push(topic);
        set!.delete(cb);
      };
    },
    subscribeHealth: (cb: (h: boolean) => void) => {
      healthSubscribeCount += 1;
      health = cb;
      cb(false);
      return () => {};
    },
    __fireTopic: (topic: string) => {
      const set = topicHandlers.get(topic);
      if (set) for (const cb of Array.from(set)) cb();
    },
    __setHealth: (h: boolean) => health(h),
    __subscribeLog: () => subscribeLog.slice(),
    __unsubscribeLog: () => unsubscribeLog.slice(),
    __healthSubscribeCount: () => healthSubscribeCount,
    __reset: () => {
      topicHandlers.clear();
      subscribeLog.length = 0;
      unsubscribeLog.length = 0;
      healthSubscribeCount = 0;
      health = () => {};
    },
  };
});

import * as eventsClient from '@/lib/events/client';
const { __fireTopic, __setHealth, __subscribeLog, __unsubscribeLog, __healthSubscribeCount, __reset } =
  eventsClient as unknown as {
    __fireTopic: (topic: string) => void;
    __setHealth: (h: boolean) => void;
    __subscribeLog: () => string[];
    __unsubscribeLog: () => string[];
    __healthSubscribeCount: () => number;
    __reset: () => void;
  };

import {
  useMemoPoller,
  POLL_INTERVAL_MS,
  LIFETIME_MS,
  SAFETY_POLL_MEMO_MS,
  type UseMemoPollerOpts,
  type UseMemoPollerResult,
} from './useMemoPoller';
import { emitMemoPollerTrigger, _resetMemoPollerSubscribers } from '@/lib/memo-poller-events';

async function flushAsync(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// Probe: exposes the hook's result via a plain mutable capture object
// (assigned during render — not React state — so tests can call `restart`
// imperatively between acts and read `expired` at any point).
type Capture = { current: UseMemoPollerResult | null };
function Probe(props: UseMemoPollerOpts & { capture: Capture }) {
  const { capture, ...opts } = props;
  const result = useMemoPoller(opts);
  capture.current = result;
  return <div data-testid="expired">{String(result.expired)}</div>;
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  __reset();
  _resetMemoPollerSubscribers();
  setVisibility('visible');
});

afterEach(() => {
  cleanup();
  _resetMemoPollerSubscribers();
  vi.useRealTimers();
});

describe('useMemoPoller', () => {
  // ---------------------------------------------------------------------
  // 1. invalidate while visible+polling → immediate onChange; while hidden
  //    → dirty, consumed on visibility-resume
  // ---------------------------------------------------------------------
  it('invalidate while visible+polling calls onChange immediately; while hidden it is deferred to visibility-resume', async () => {
    const onChange = vi.fn();
    const capture: Capture = { current: null };
    render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={onChange}
        fetchLatestUpdatedAt={async () => null}
        initialBaseline={null}
        autoStart={{ active: true, mintedAt: null }}
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    await act(async () => {
      __fireTopic('memo:sess-1');
      await flushAsync();
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // Restart the cycle (invalidate() reset it to idle after firing), then
    // go hidden and fire again — must NOT call onChange while hidden.
    act(() => {
      capture.current!.restart();
    });
    setVisibility('hidden');
    await act(async () => {
      __fireTopic('memo:sess-1');
      await flushAsync();
    });
    expect(onChange).toHaveBeenCalledTimes(1); // still 1 — deferred, not dropped

    // Resume visibility — the deferred invalidate fires now.
    await act(async () => {
      setVisibility('visible');
      await flushAsync();
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------
  // 2. healthy SSE → 20s cadence suppression; unhealthy/drop → re-armed 3s
  // ---------------------------------------------------------------------
  it('polls at 3s while SSE is unhealthy, demotes to 20s once healthy, and re-arms 3s on drop', async () => {
    const fetchLatestUpdatedAt = vi.fn(async () => null);
    const capture: Capture = { current: null };
    render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={() => {}}
        fetchLatestUpdatedAt={fetchLatestUpdatedAt}
        initialBaseline={null}
        autoStart={{ active: true, mintedAt: null }}
      />,
    );
    await act(async () => {
      await flushAsync();
    });
    const callsBefore = fetchLatestUpdatedAt.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchLatestUpdatedAt.mock.calls.length).toBeGreaterThan(callsBefore);

    await act(async () => {
      __setHealth(true);
      await flushAsync();
    });
    const callsAtHealthy = fetchLatestUpdatedAt.mock.calls.length;

    // Well under the 20s safety cadence — no new fetch at 10s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchLatestUpdatedAt.mock.calls.length).toBe(callsAtHealthy);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAFETY_POLL_MEMO_MS - 10_000);
    });
    expect(fetchLatestUpdatedAt.mock.calls.length).toBeGreaterThan(callsAtHealthy);

    // Health drops: re-arms the fast 3s cadence.
    const callsAtDrop = fetchLatestUpdatedAt.mock.calls.length;
    await act(async () => {
      __setHealth(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchLatestUpdatedAt.mock.calls.length).toBeGreaterThan(callsAtDrop);
  });

  // ---------------------------------------------------------------------
  // 3. expired never resurrected by SSE invalidate
  // ---------------------------------------------------------------------
  it('an expired machine is never resurrected by an SSE invalidate', async () => {
    const onChange = vi.fn();
    const capture: Capture = { current: null };
    render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={onChange}
        fetchLatestUpdatedAt={async () => null} // never changes → never completes normally
        initialBaseline={null}
        autoStart={{ active: true, mintedAt: null }}
        lifetimeMs={50}
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    // One 3s tick blows well past the 50ms lifetime → expires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(capture.current!.expired).toBe(true);

    await act(async () => {
      __fireTopic('memo:sess-1');
      await flushAsync();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(capture.current!.expired).toBe(true); // still expired, not silently cleared
  });

  // ---------------------------------------------------------------------
  // 4. pillar-shape unanchored auto-start
  // ---------------------------------------------------------------------
  it('pillar-shape auto-start (mintedAt: null) starts anchored at now with no expiry pre-check', async () => {
    const onChange = vi.fn();
    const capture: Capture = { current: null };
    render(
      <Probe
        capture={capture}
        topicId="analysis-1"
        onChange={onChange}
        fetchLatestUpdatedAt={async () => 'CHANGED'} // differs from initialBaseline immediately
        initialBaseline={null}
        autoStart={{ active: true, mintedAt: null }}
      />,
    );
    await act(async () => {
      await flushAsync();
    });
    expect(capture.current!.expired).toBe(false); // no expiry pre-check ever ran

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    // Proves the machine was actually started (status 'polling') — a tick
    // fired and detected the baseline/latest mismatch.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------
  // 5. card-shape anchored auto-start: stale mint → expired without starting
  // ---------------------------------------------------------------------
  it('card-shape auto-start with a stale mint flips to expired WITHOUT starting the machine', async () => {
    const onChange = vi.fn();
    const capture: Capture = { current: null };
    const staleMintedAt = new Date(Date.now() - LIFETIME_MS - 60_000).toISOString();
    render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={onChange}
        fetchLatestUpdatedAt={async () => 'ANYTHING'} // would differ from baseline if ever ticked
        initialBaseline={null}
        autoStart={{ active: true, mintedAt: staleMintedAt }}
      />,
    );
    await act(async () => {
      await flushAsync();
    });
    expect(capture.current!.expired).toBe(true);

    // Confirm it truly never started polling: advance well past several
    // intervals and the safety cadence — no tick ever fires onChange.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAFETY_POLL_MEMO_MS * 2);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // 6. baselineRef ?? latest first-response backfill on tick
  // ---------------------------------------------------------------------
  it('backfills baselineRef from the first tick response when it was missing, so a later restart does not re-treat the same value as a change', async () => {
    const onChange = vi.fn();
    const capture: Capture = { current: null };
    let latest: string | null = 'V1'; // first response is already non-null
    render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={onChange}
        fetchLatestUpdatedAt={async () => latest}
        initialBaseline={null} // baselineRef starts null — nothing to compare against yet
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    // Start a cycle from the current (null) baselineRef, mirroring the
    // expired-retry button.
    act(() => {
      capture.current!.restart();
    });
    // First tick: machine's internal baseline is null, latest is 'V1' —
    // that's a change, onChange fires once, machine resets to idle. The
    // backfill line also runs this same tick, setting baselineRef.current
    // to 'V1' (it was null before).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // Restart again with NO baselineNull — if the backfill happened,
    // baselineRef.current is now 'V1', so a tick that still sees 'V1'
    // (server value unchanged) must NOT be treated as a change. If the
    // backfill had NOT happened, baselineRef.current would still be null,
    // and this same 'V1' tick would incorrectly fire onChange a second time.
    act(() => {
      capture.current!.restart();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(onChange).toHaveBeenCalledTimes(1); // unchanged — backfill proven
  });

  // ---------------------------------------------------------------------
  // 7. syncBaselineWhenIdle updates baseline ONLY while idle
  // ---------------------------------------------------------------------
  it('syncBaselineWhenIdle updates baselineRef only while the machine is idle, never mid-cycle', async () => {
    const onChange = vi.fn();
    const capture: Capture = { current: null };
    const { rerender } = render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={onChange}
        fetchLatestUpdatedAt={async () => null}
        initialBaseline={null}
        syncBaselineWhenIdle={null}
        autoStart={{ active: true, mintedAt: null }}
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    // Mid-cycle: the machine is polling. Re-render with a NEW
    // syncBaselineWhenIdle value — it must be ignored while polling.
    await act(async () => {
      rerender(
        <Probe
          capture={capture}
          topicId="sess-1"
          onChange={onChange}
          fetchLatestUpdatedAt={async () => null}
          initialBaseline={null}
          syncBaselineWhenIdle="MID_CYCLE_VALUE"
          autoStart={{ active: true, mintedAt: null }}
        />,
      );
      await flushAsync();
    });

    // Prove it was ignored: restart() (no baselineNull) uses baselineRef.current
    // as-is. If the mid-cycle sync had wrongly applied, baselineRef.current
    // would be 'MID_CYCLE_VALUE', and a tick returning that SAME value would
    // be treated as "no change". Since sync must be skipped mid-cycle,
    // baselineRef.current stays null, so a tick returning 'MID_CYCLE_VALUE'
    // must register as a CHANGE (null !== 'MID_CYCLE_VALUE') → onChange fires.
    act(() => {
      capture.current!.restart();
    });
    let latest: string | null = 'MID_CYCLE_VALUE';
    await act(async () => {
      // Swap the probe's fetch fn to return the mid-cycle value for this tick.
      rerender(
        <Probe
          capture={capture}
          topicId="sess-1"
          onChange={onChange}
          fetchLatestUpdatedAt={async () => latest}
          initialBaseline={null}
          syncBaselineWhenIdle="MID_CYCLE_VALUE"
          autoStart={{ active: true, mintedAt: null }}
        />,
      );
      // Flush so the fetchLatestUpdatedAt ref-sync effect commits before the
      // timer fires (mirrors the rerender+flush-then-advance pattern used
      // elsewhere in this file).
      await flushAsync();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(onChange).toHaveBeenCalledTimes(1); // proves sync was skipped mid-cycle

    // Now the machine is idle again (onChange fired → reset). Re-render with
    // a fresh syncBaselineWhenIdle value — this one MUST apply.
    await act(async () => {
      rerender(
        <Probe
          capture={capture}
          topicId="sess-1"
          onChange={onChange}
          fetchLatestUpdatedAt={async () => latest}
          initialBaseline={null}
          syncBaselineWhenIdle="IDLE_APPLIED_VALUE"
          autoStart={undefined}
        />,
      );
      await flushAsync();
    });

    act(() => {
      capture.current!.restart();
    });
    latest = 'IDLE_APPLIED_VALUE';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    // baselineRef.current is 'IDLE_APPLIED_VALUE' (synced while idle), so a
    // tick returning that same value is NOT a change — call count stays 1.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------
  // 8. fetchLatestUpdatedAt returning undefined skips machine.tick entirely
  // ---------------------------------------------------------------------
  it('fetchLatestUpdatedAt resolving undefined skips machine.tick entirely', async () => {
    const onChange = vi.fn();
    const capture: Capture = { current: null };
    render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={onChange}
        fetchLatestUpdatedAt={async () => undefined}
        initialBaseline={null}
        autoStart={{ active: true, mintedAt: null }}
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    // If tick() were still invoked with `undefined`, `undefined !== null`
    // would read as an immediate change on the very first tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(onChange).not.toHaveBeenCalled();

    // And since tick() (which accumulates active time) is never reached,
    // the machine never expires either, no matter how long we wait.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIFETIME_MS * 2);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(capture.current!.expired).toBe(false);
  });

  // ---------------------------------------------------------------------
  // 9. subscribePollerTrigger: true → onMemoPollerTrigger starts a cycle
  // ---------------------------------------------------------------------
  it('subscribePollerTrigger:true starts a cycle from the current baseline when onMemoPollerTrigger fires', async () => {
    const onChange = vi.fn();
    const fetchLatestUpdatedAt = vi.fn(async () => null);
    const capture: Capture = { current: null };
    render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={onChange}
        fetchLatestUpdatedAt={fetchLatestUpdatedAt}
        initialBaseline={null}
        subscribePollerTrigger
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    // Not started yet — a tick should be a no-op (machine.status() !== 'polling').
    const callsBefore = fetchLatestUpdatedAt.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchLatestUpdatedAt.mock.calls.length).toBe(callsBefore);

    await act(async () => {
      emitMemoPollerTrigger();
      await flushAsync();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchLatestUpdatedAt.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('subscribePollerTrigger omitted/false never subscribes to onMemoPollerTrigger', async () => {
    const fetchLatestUpdatedAt = vi.fn(async () => null);
    const capture: Capture = { current: null };
    render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={() => {}}
        fetchLatestUpdatedAt={fetchLatestUpdatedAt}
        initialBaseline={null}
      />,
    );
    await act(async () => {
      await flushAsync();
    });
    const callsBefore = fetchLatestUpdatedAt.mock.calls.length;
    await act(async () => {
      emitMemoPollerTrigger();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchLatestUpdatedAt.mock.calls.length).toBe(callsBefore); // trigger had no subscriber
  });

  // ---------------------------------------------------------------------
  // 10. empty topicId → no subscription created
  // ---------------------------------------------------------------------
  it('an empty topicId subscribes to nothing', async () => {
    const capture: Capture = { current: null };
    render(
      <Probe
        capture={capture}
        topicId=""
        onChange={() => {}}
        fetchLatestUpdatedAt={async () => null}
        initialBaseline={null}
      />,
    );
    await act(async () => {
      await flushAsync();
    });
    expect(__subscribeLog()).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // 11. reactive topicId change → unsubscribe old, subscribe new
  // ---------------------------------------------------------------------
  it('re-subscribes when topicId changes: old topic unsubscribed, new topic subscribed, old topic events no longer reach onChange', async () => {
    const onChange = vi.fn();
    const capture: Capture = { current: null };
    const { rerender } = render(
      <Probe
        capture={capture}
        topicId="topic-a"
        onChange={onChange}
        fetchLatestUpdatedAt={async () => null}
        initialBaseline={null}
      />,
    );
    await act(async () => {
      await flushAsync();
    });
    expect(__subscribeLog()).toEqual(['memo:topic-a']);

    await act(async () => {
      rerender(
        <Probe
          capture={capture}
          topicId="topic-b"
          onChange={onChange}
          fetchLatestUpdatedAt={async () => null}
          initialBaseline={null}
        />,
      );
      await flushAsync();
    });
    expect(__unsubscribeLog()).toContain('memo:topic-a');
    expect(__subscribeLog()).toContain('memo:topic-b');

    // Firing the OLD topic must no longer reach onChange.
    await act(async () => {
      __fireTopic('memo:topic-a');
      await flushAsync();
    });
    expect(onChange).not.toHaveBeenCalled();

    // Firing the NEW topic does.
    await act(async () => {
      __fireTopic('memo:topic-b');
      await flushAsync();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------
  // 12. restart({baselineNull:true}) — regenerate; hook owns no memo state
  // ---------------------------------------------------------------------
  it('restart({baselineNull:true}) starts a cycle with null baseline; a still-null tick does not complete it, and a real write-back does', async () => {
    const onChange = vi.fn();
    const capture: Capture = { current: null };
    let latest: string | null = null;
    render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={onChange}
        fetchLatestUpdatedAt={async () => latest}
        initialBaseline="OLD_VALUE"
      />,
    );
    await act(async () => {
      await flushAsync();
    });

    // The hook exposes no memo/content state — only { expired, restart }.
    expect(Object.keys(capture.current!).sort()).toEqual(['expired', 'restart']);

    act(() => {
      capture.current!.restart({ baselineNull: true });
    });

    // First tick: the freshly-minted row still has a null updatedAt (not
    // generated yet) — must NOT be treated as a change relative to OLD_VALUE
    // being wiped, and must not complete the cycle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(capture.current!.expired).toBe(false);

    // The skill posts back a real write-back — the cycle completes.
    latest = 'NEW_VALUE';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------
  // 13. onChange/fetchLatestUpdatedAt freshness + no timer re-creation
  // ---------------------------------------------------------------------
  it('routes onChange/fetchLatestUpdatedAt through refs: always invokes the LATEST callback, and never tears down/recreates the poll interval across re-renders with new inline callback identities', async () => {
    const onChangeA = vi.fn();
    const onChangeB = vi.fn();
    const fetchA = vi.fn(async () => null as string | null);
    const fetchB = vi.fn(async () => 'CHANGED');
    const capture: Capture = { current: null };

    const { rerender } = render(
      <Probe
        capture={capture}
        topicId="sess-1"
        onChange={onChangeA}
        fetchLatestUpdatedAt={fetchA}
        initialBaseline={null}
        autoStart={{ active: true, mintedAt: null }}
      />,
    );
    await act(async () => {
      await flushAsync();
    });
    expect(__healthSubscribeCount()).toBe(1);

    // Re-render several times with brand-new inline callback identities.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rerender(
          <Probe
            capture={capture}
            topicId="sess-1"
            onChange={onChangeA}
            fetchLatestUpdatedAt={fetchA}
            initialBaseline={null}
            autoStart={{ active: true, mintedAt: null }}
          />,
        );
        await flushAsync();
      });
    }
    // The interval effect never tore down/remounted — subscribeHealth was
    // called exactly once for the whole component lifetime.
    expect(__healthSubscribeCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchA).toHaveBeenCalled();
    expect(fetchB).not.toHaveBeenCalled();

    // Swap to brand-new callback identities — still no interval recreation,
    // and the NEXT tick must call the NEW fetch fn / the NEW onChange, not
    // the stale ones.
    await act(async () => {
      rerender(
        <Probe
          capture={capture}
          topicId="sess-1"
          onChange={onChangeB}
          fetchLatestUpdatedAt={fetchB}
          initialBaseline={null}
          autoStart={{ active: true, mintedAt: null }}
        />,
      );
      await flushAsync();
    });
    expect(__healthSubscribeCount()).toBe(1); // still just the one mount

    const fetchACallsBefore = fetchA.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchB).toHaveBeenCalled();
    expect(fetchA.mock.calls.length).toBe(fetchACallsBefore); // stale fn never called again
    expect(onChangeB).toHaveBeenCalledTimes(1); // fired via the NEW onChange
    expect(onChangeA).not.toHaveBeenCalled(); // never via the stale one
  });
});
