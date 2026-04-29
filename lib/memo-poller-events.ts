// lib/memo-poller-events.ts
// Tiny module-level pub/sub used so the "Copy Claude Prompt" /
// "Regenerate via Claude" button can wake the MemoPoller without
// prop-drilling through page.tsx. Exactly one poller is mounted per
// pillar-analysis dashboard page, so the global Set of subscribers is fine.

type Listener = () => void;
const listeners = new Set<Listener>();

export function onMemoPollerTrigger(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitMemoPollerTrigger(): void {
  for (const fn of listeners) fn();
}

// Test-only helper. Exported with an underscore to discourage non-test use.
export function _resetMemoPollerSubscribers(): void {
  listeners.clear();
}
