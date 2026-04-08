/**
 * Next.js instrumentation hook — runs once at server startup before any requests.
 *
 * Node.js 18 does not expose `File` as a global (added in Node.js 20).
 * The native Request.formData() uses `File` internally, so it throws
 * "ReferenceError: File is not defined" on Node 18 without this polyfill.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (typeof globalThis.File === 'undefined') {
      const { File } = await import('buffer');
      (globalThis as unknown as Record<string, unknown>).File = File;
    }

    // Close the headless browser cleanly on shutdown so Chrome doesn't orphan.
    // fuser -k in the deploy command sends SIGTERM before starting the new process.
    const { closeBrowser } = await import('@/lib/ada-audit/browser-pool')

    // Run full cleanup (orphan uploads, expired sessions, share links, screenshots).
    // Runs at startup + once per day.
    const { runCleanup } = await import('@/lib/cleanup')
    void runCleanup()
    const cleanupInterval = setInterval(() => void runCleanup(), 24 * 60 * 60 * 1000)

    // Recover queued/stale audits from crashes and kick the queue processor
    const { recoverQueue, resetStaleAudits } = await import('@/lib/ada-audit/queue-manager')
    void recoverQueue()

    // Periodic stale audit check (every 10 minutes)
    const staleCheckInterval = setInterval(() => void resetStaleAudits(), 10 * 60 * 1000)

    const shutdown = () => {
      clearInterval(cleanupInterval)
      clearInterval(staleCheckInterval)
      void closeBrowser()
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  }
}
