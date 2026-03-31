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
    const shutdown = () => { void closeBrowser() }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  }
}
