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

    // Fail fast in production if the pillar token signing secret is missing.
    // The mint/verify helpers also throw on use, but failing at startup makes
    // deployment misconfiguration loud rather than silent. Dev environments
    // continue with a logged warning + deterministic fallback (see pillar-token.ts).
    if (process.env.NODE_ENV === 'production' && !process.env.PILLAR_TOKEN_SECRET) {
      // eslint-disable-next-line no-console
      console.error(
        '[startup] PILLAR_TOKEN_SECRET is required in production but is unset. Refusing to start.',
      );
      process.exit(1);
    }

    // Fail fast in production if the app-wide password gate is not configured.
    // Dev/test can intentionally run without APP_AUTH_PASSWORD; middleware then
    // enables a local-only bypass when NODE_ENV !== 'production'.
    const { requireAuthConfig } = await import('@/lib/auth')
    try {
      requireAuthConfig()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[startup] ${err instanceof Error ? err.message : 'APP_AUTH_PASSWORD is required in production'}. Refusing to start.`,
      )
      process.exit(1)
    }

    // Chromium owns its own resolver/network stack, so request interception alone
    // cannot close DNS rebinding. In production require an explicit egress guard:
    // either a Chrome proxy or a server/network firewall confirmation.
    const {
      hasConfirmedBrowserNetworkIsolation,
      requireBrowserEgressGuardConfig,
    } = await import('@/lib/ada-audit/browser-egress')
    try {
      requireBrowserEgressGuardConfig()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[startup] ${err instanceof Error ? err.message : 'Chromium egress guard is required in production'}. Refusing to start.`,
      )
      process.exit(1)
    }
    if (process.env.NODE_ENV === 'production' && hasConfirmedBrowserNetworkIsolation()) {
      // eslint-disable-next-line no-console
      console.warn(
        '[startup] CHROMIUM_NETWORK_ISOLATED=true assumes host/network firewall rules block Chromium from private, link-local, and reserved networks.',
      )
    }

    // Initialize SQLite PRAGMAs before any audit writes so the first write doesn't
    // race with PRAGMA setup. Idempotent, safe to call multiple times.
    const { initPragmas } = await import('@/lib/db')
    await initPragmas()

    // Close the headless browser cleanly on shutdown so Chrome doesn't orphan.
    // fuser -k in the deploy command sends SIGTERM before starting the new process.
    const { closeBrowser } = await import('@/lib/ada-audit/browser-pool')

    // Run full cleanup (orphan uploads, expired sessions, share links, screenshots).
    // Runs at startup + once per day.
    const { runCleanup } = await import('@/lib/cleanup')
    void runCleanup()
    const cleanupInterval = setInterval(() => void runCleanup(), 24 * 60 * 60 * 1000)

    // Job queue boot order (each step depends on the previous):
    // 1. Register handlers — startup recovery may run onExhausted hooks,
    //    which need a populated registry.
    // 2. recoverJobsOnStartup — recoverQueue decides parent-audit survival
    //    based on active jobs in the Job table.
    // 3. recoverQueue (awaited) — parent recovery decisions are still partly
    //    non-durable in Phase 1; make them deterministic before any claims.
    // 4. startJobWorker — only now may jobs start draining.
    const { registerBuiltInJobHandlers } = await import('@/lib/jobs/handlers/register')
    registerBuiltInJobHandlers()
    const { recoverJobsOnStartup } = await import('@/lib/jobs/recovery')
    await recoverJobsOnStartup()

    // Recover queued/stale audits from crashes and kick the queue processor
    const { recoverQueue, resetStaleAudits } = await import('@/lib/ada-audit/queue-manager')
    await recoverQueue()

    const { startJobWorker, stopJobWorker } = await import('@/lib/jobs/worker')
    await startJobWorker()

    // Periodic stale audit check (every 10 minutes)
    const staleCheckInterval = setInterval(() => void resetStaleAudits(), 10 * 60 * 1000)

    // Delete screenshot dirs older than 24h after their audit completed.
    const { startScreenshotSweeper, stopScreenshotSweeper } = await import('@/lib/ada-audit/screenshot-sweeper')
    startScreenshotSweeper()

    let shuttingDown = false
    const shutdown = async () => {
      if (shuttingDown) return
      shuttingDown = true
      clearInterval(cleanupInterval)
      clearInterval(staleCheckInterval)
      stopScreenshotSweeper()
      try {
        await stopJobWorker()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[shutdown] Failed to stop job worker:', err)
      }
      try {
        await closeBrowser()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[shutdown] Failed to close headless browser:', err)
        process.exitCode = 1
      } finally {
        process.exit()
      }
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  }
}
