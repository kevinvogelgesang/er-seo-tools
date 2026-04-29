import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onMemoPollerTrigger, emitMemoPollerTrigger, _resetMemoPollerSubscribers } from './memo-poller-events';

describe('memo-poller-events', () => {
  beforeEach(() => {
    _resetMemoPollerSubscribers();
  });

  it('calls subscribers when emit is fired', () => {
    const fn = vi.fn();
    onMemoPollerTrigger(fn);
    emitMemoPollerTrigger();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns an unsubscribe function', () => {
    const fn = vi.fn();
    const unsub = onMemoPollerTrigger(fn);
    unsub();
    emitMemoPollerTrigger();
    expect(fn).not.toHaveBeenCalled();
  });

  it('supports multiple subscribers', () => {
    const a = vi.fn();
    const b = vi.fn();
    onMemoPollerTrigger(a);
    onMemoPollerTrigger(b);
    emitMemoPollerTrigger();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('emit with no subscribers is a no-op', () => {
    expect(() => emitMemoPollerTrigger()).not.toThrow();
  });
});
