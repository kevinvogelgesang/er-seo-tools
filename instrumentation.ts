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

    // Smoke-only loopback audit allowance (fail CLOSED outside smoke mode). If
    // SMOKE_LOOPBACK_TARGET is set, the app must be unambiguously in smoke mode:
    // SMOKE_MODE=true + loopback NEXT_PUBLIC_APP_URL + a loopback host:port target
    // with an explicit port. Any other combination (e.g. a real deploy with a
    // public base URL) is refused so a stray var can never widen SSRF in prod.
    if (process.env.NODE_ENV === 'production' && process.env.SMOKE_LOOPBACK_TARGET) {
      const isLoopback = (h?: string) => h === 'localhost' || h === '127.0.0.1' || h === '::1'
      let targetOk = false
      try {
        const u = new URL('http://' + process.env.SMOKE_LOOPBACK_TARGET)
        targetOk = Boolean(u.port) && isLoopback(u.hostname.toLowerCase())
      } catch { targetOk = false }
      let baseOk = false
      try {
        baseOk = isLoopback(new URL(process.env.NEXT_PUBLIC_APP_URL ?? '').hostname.toLowerCase())
      } catch { baseOk = false }
      const smokeMode = process.env.SMOKE_MODE === 'true'
      if (!(smokeMode && baseOk && targetOk)) {
        // eslint-disable-next-line no-console
        console.error(
          '[startup] SMOKE_LOOPBACK_TARGET is set outside smoke mode (needs SMOKE_MODE=true + loopback NEXT_PUBLIC_APP_URL + loopback host:port target). Refusing to start.'
        )
        process.exit(1)
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[startup] SMOKE MODE - loopback audit target ${process.env.SMOKE_LOOPBACK_TARGET} allowlisted. Never set these in a real deployment.`
      )
    }

    // Initialize SQLite PRAGMAs before any audit writes so the first write doesn't
    // race with PRAGMA setup. Idempotent, safe to call multiple times.
    const { initPragmas } = await import('@/lib/db')
    await initPragmas()

    // Close the headless browser cleanly on shutdown so Chrome doesn't orphan.
    // fuser -k in the deploy command sends SIGTERM before starting the new process.
    const { closeBrowser } = await import('@/lib/ada-audit/browser-pool')

    // Inline startup cleanup ("run at boot" isn't a cadence). The daily
    // recurrence runs via the 'cleanup' scheduled job — see
    // lib/jobs/system-schedules.ts. Same for the 10-min stale-audit reset
    // and 30-min screenshot sweep; instrumentation owns no setIntervals.
    const { runCleanup } = await import('@/lib/cleanup')
    void runCleanup()

    // Job queue boot order (each step depends on the previous):
    // 1. Register handlers — startup recovery may run onExhausted hooks,
    //    which need a populated registry.
    // 2. recoverJobsOnStartup — recoverQueue decides parent-audit survival
    //    based on active jobs in the Job table.
    // 3. recoverQueue (awaited) — resumes transient parents with outstanding
    //    durable jobs (incl. 'running' since Phase 3), finalizes drained
    //    ones, fails the rest. Deterministic before any claims.
    // 4. seedSystemSchedules — upsert the code-owned system-* Schedule rows
    //    so the worker's first tick sees them.
    // 5. startJobWorker — only now may jobs start draining.
    const { registerBuiltInJobHandlers } = await import('@/lib/jobs/handlers/register')
    registerBuiltInJobHandlers()
    const { recoverJobsOnStartup } = await import('@/lib/jobs/recovery')
    await recoverJobsOnStartup()

    // Recover queued/stale audits from crashes and kick the queue processor
    const { recoverQueue } = await import('@/lib/ada-audit/queue-manager')
    await recoverQueue()

    const { seedSystemSchedules } = await import('@/lib/jobs/system-schedules')
    await seedSystemSchedules()

    const { startJobWorker, stopJobWorker } = await import('@/lib/jobs/worker')
    await startJobWorker()

    let shuttingDown = false
    const shutdown = async () => {
      if (shuttingDown) return
      shuttingDown = true
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
