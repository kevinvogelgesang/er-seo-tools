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
    const { SCREENSHOTS_DIR } = await import('@/lib/ada-audit/screenshot-helpers')
    const { prisma } = await import('@/lib/db')
    const { promises: fs } = await import('fs')
    const path = await import('path')

    // Clean up screenshot directories older than 7 days. Runs at startup + once per day.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
    const runScreenshotCleanup = async () => {
      try {
        const entries = await fs.readdir(SCREENSHOTS_DIR).catch(() => [] as string[])
        const cutoff = Date.now() - SEVEN_DAYS_MS
        for (const entry of entries) {
          const audit = await prisma.adaAudit.findUnique({
            where: { id: entry },
            select: { createdAt: true },
          }).catch(() => null)
          if (!audit || audit.createdAt.getTime() < cutoff) {
            await fs.rm(path.join(SCREENSHOTS_DIR, entry), { recursive: true, force: true }).catch(() => {})
          }
        }
      } catch { /* never crash the process */ }
    }
    void runScreenshotCleanup()
    const cleanupInterval = setInterval(runScreenshotCleanup, 24 * 60 * 60 * 1000)

    const shutdown = () => {
      clearInterval(cleanupInterval)
      void closeBrowser()
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  }
}
