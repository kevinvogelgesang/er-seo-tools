import { describe, it, expect, vi } from 'vitest';
import { createPollingMachine } from './memo-poller-machine';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

describe('createPollingMachine', () => {
  function setup() {
    const onChange = vi.fn();
    const m = createPollingMachine({ onChange, lifetimeMs: FIFTEEN_MIN_MS });
    return { m, onChange };
  }

  it('starts in idle status', () => {
    const { m } = setup();
    expect(m.status()).toBe('idle');
  });

  it('start(baseline) transitions to polling', () => {
    const { m } = setup();
    m.start({ baseline: null, now: 0 });
    expect(m.status()).toBe('polling');
  });

  it('tick with unchanged baseline keeps polling and does not call onChange', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.tick({ latestUpdatedAt: null, now: 3000 });
    expect(m.status()).toBe('polling');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('tick with changed baseline (null → string) calls onChange and stops', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.tick({ latestUpdatedAt: '2026-04-29T12:00:00Z', now: 3000 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(m.status()).toBe('idle');
  });

  it('tick with changed baseline (old string → newer string) calls onChange and stops', () => {
    const { m, onChange } = setup();
    m.start({ baseline: '2026-04-29T11:00:00Z', now: 0 });
    m.tick({ latestUpdatedAt: '2026-04-29T12:00:00Z', now: 3000 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(m.status()).toBe('idle');
  });

  it('onChange fires exactly once even if tick sees the change again', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.tick({ latestUpdatedAt: 'x', now: 3000 });
    // Caller should not call tick after status is idle, but verify defensively.
    m.tick({ latestUpdatedAt: 'x', now: 6000 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('setVisible(false) pauses; tick does nothing while paused', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.setVisible(false);
    expect(m.status()).toBe('paused');
    m.tick({ latestUpdatedAt: 'x', now: 3000 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('setVisible(true) resumes from paused', () => {
    const { m } = setup();
    m.start({ baseline: null, now: 0 });
    m.setVisible(false);
    m.setVisible(true);
    expect(m.status()).toBe('polling');
  });

  it('time spent paused does not count toward lifetime cap', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    // 5 min active polling
    m.tick({ latestUpdatedAt: null, now: 5 * 60 * 1000 });
    // Pause for 20 minutes (longer than the cap)
    m.setVisible(false);
    m.tick({ latestUpdatedAt: null, now: 25 * 60 * 1000 });
    // Resume — only 5 min of active time has elapsed
    m.setVisible(true);
    // Tick again 9 min later — still under the 15 min cap (5 + 9 = 14)
    m.tick({ latestUpdatedAt: null, now: (25 + 9) * 60 * 1000 });
    expect(m.status()).toBe('polling');
    // Tick once more, 2 more minutes — now 16 min active total → expired
    m.tick({ latestUpdatedAt: null, now: (25 + 11) * 60 * 1000 });
    expect(m.status()).toBe('expired');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('expires when cumulative active time exceeds lifetimeMs', () => {
    const { m } = setup();
    m.start({ baseline: null, now: 0 });
    // Tick once near the cap
    m.tick({ latestUpdatedAt: null, now: FIFTEEN_MIN_MS - 1000 });
    expect(m.status()).toBe('polling');
    // Next tick crosses the cap
    m.tick({ latestUpdatedAt: null, now: FIFTEEN_MIN_MS + 1000 });
    expect(m.status()).toBe('expired');
  });

  it('a change observed on the lifetime-boundary tick fires onChange, not expiry', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    // This tick BOTH crosses the lifetime cap AND observes a write-back.
    // The confirmed change must win — the result must not be dropped.
    m.tick({ latestUpdatedAt: 'wrote-back', now: FIFTEEN_MIN_MS + 1000 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(m.status()).not.toBe('expired');
  });

  it('start() while polling resets the baseline and lifetime budget', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.tick({ latestUpdatedAt: null, now: 10 * 60 * 1000 });
    // Re-trigger with a new baseline
    m.start({ baseline: 'baseline-from-existing-memo', now: 10 * 60 * 1000 });
    expect(m.status()).toBe('polling');
    // With the budget reset, a tick 10 more minutes later is still allowed
    m.tick({ latestUpdatedAt: 'baseline-from-existing-memo', now: 20 * 60 * 1000 });
    expect(m.status()).toBe('polling');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('start() from expired re-enters polling', () => {
    const { m } = setup();
    m.start({ baseline: null, now: 0 });
    m.tick({ latestUpdatedAt: null, now: FIFTEEN_MIN_MS + 1000 });
    expect(m.status()).toBe('expired');
    m.start({ baseline: null, now: FIFTEEN_MIN_MS + 1000 });
    expect(m.status()).toBe('polling');
  });

  it('start() while paused with pending sentinel resets cleanly', () => {
    const { m, onChange } = setup();
    m.start({ baseline: null, now: 0 });
    m.setVisible(false);
    m.setVisible(true); // sets sentinel: lastResumedAt = -1
    // Re-start before any tick fires.
    m.start({ baseline: null, now: 5000 });
    expect(m.status()).toBe('polling');
    // First tick should accumulate from start.now (5000) to tick.now (8000) = 3000ms — no blow-up.
    m.tick({ latestUpdatedAt: null, now: 8000 });
    expect(m.status()).toBe('polling');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stop() transitions to idle', () => {
    const { m } = setup();
    m.start({ baseline: null, now: 0 });
    m.stop();
    expect(m.status()).toBe('idle');
  });
});
