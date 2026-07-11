// lib/keywords/volume-throttle.ts
//
// KS-2 module-scoped process-wide rolling throttle (spec §5.3, Codex #2 /
// plan #5). One shared scheduler for ALL getKeywordVolumes callers — a
// rolling <= maxRequests-per-windowMs window. Per-invocation serial spacing
// alone would not protect concurrent KS-5 callers, so this is shared state.

export function createThrottle(opts: {
  maxRequests: number
  windowMs: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): { acquire(): Promise<void> } {
  const { maxRequests, windowMs } = opts
  const now = opts.now ?? Date.now
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  // Timestamps of the last (up to maxRequests) GRANTS, oldest first. Grants
  // are recorded AT GRANT TIME (after any waiting), never at enqueue time.
  const grants: number[] = []

  async function acquireOnce(): Promise<void> {
    for (;;) {
      const t = now()
      while (grants.length > 0 && t - grants[0] >= windowMs) {
        grants.shift()
      }
      if (grants.length < maxRequests) {
        grants.push(t)
        return
      }
      // Full: sleep until the oldest grant is due to fall out of the window,
      // then loop back around to RE-CHECK the clock — sleep may
      // under-deliver, so a single sleep is never assumed sufficient.
      const waitMs = grants[0] + windowMs - t
      await sleep(Math.max(waitMs, 0))
    }
  }

  // Concurrent acquires are serialized via an internal promise chain: each
  // acquire's real work only starts once the previous link has settled.
  // `tail` itself must NEVER reject — a rejected acquire/sleep must fail only
  // ITS OWN caller (the `result` promise returned below), not poison every
  // later acquire. Mirrors the derived-promise-safety lesson in
  // gsc-snapshot.ts's single-flight `.finally().catch(() => {})` comment:
  // the `.catch(() => {})` below is attached to a DERIVED chain (`tail`),
  // while the original `result` promise (returned to the caller) still
  // rejects normally.
  let tail: Promise<void> = Promise.resolve()

  function acquire(): Promise<void> {
    const result = tail.then(() => acquireOnce())
    tail = result.catch(() => {
      /* observed by the corresponding caller via `result`; the chain recovers */
    })
    return result
  }

  return { acquire }
}

/** Process-wide singleton shared by every getKeywordVolumes caller (spec §5.3). */
export const volumeThrottle = createThrottle({ maxRequests: 12, windowMs: 60_000 })
