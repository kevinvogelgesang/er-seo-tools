// lib/log/index.ts
//
// A4 observability — structured logger. Prod: plain JSON to stdout (NO transport
// worker), which PM2 rotates. Dev: pino-pretty (a devDependency) via a lazy,
// try/caught transport that falls back to plain pino if it can't load. The
// logger is server-only and never .toString()-injected into an audited page, so
// the SWC-helper hazard does not apply. It must never participate in the
// instrumentation.ts fail-fast boot exits — construction is fully guarded.
import pino, { type Logger } from 'pino'

function createLogger(): Logger {
  const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
  // Guarded end-to-end: an invalid LOG_LEVEL or a failed transport must NEVER throw
  // at import time. This module is imported at top-level by the worker, the health
  // route, and ops-snapshot — a throw here would crash-loop the app on boot, which
  // is exactly the fail-fast behavior this logger promises never to add.
  try {
    // Gate pretty transport to development ONLY. Under NODE_ENV='test' (vitest) a
    // transport worker thread leaks open handles; and prod has no dev deps.
    if (process.env.NODE_ENV === 'development') {
      try {
        return pino({ level, transport: { target: 'pino-pretty', options: { colorize: true } } })
      } catch {
        // pino-pretty absent or transport failed — fall through to plain JSON.
      }
    }
    // Write to stderr (fd 2) so error-level failures land in the PM2 *error* log,
    // matching the console.error/warn streams these callsites replaced.
    return pino({ level }, pino.destination(2))
  } catch {
    // Last resort (e.g. `pino` rejected an invalid LOG_LEVEL): a safe default
    // logger that cannot throw at construction.
    return pino({ level: 'info' }, pino.destination(2))
  }
}

export const logger: Logger = createLogger()

export function serializeError(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack }
  return { message: String(err) }
}

export function logError(context: Record<string, unknown>, err: unknown): void {
  // A logger must never throw into its callers (e.g. EPIPE on a broken stdout/stderr
  // pipe, or a serialization edge). At the worker seam a throw here would skip the
  // domain onExhausted cleanup, stranding an audit — so swallow everything.
  try {
    logger.error({ ...context, err: serializeError(err) })
  } catch {
    /* never propagate a logging failure */
  }
}
