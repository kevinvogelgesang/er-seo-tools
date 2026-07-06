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
  // Gate pretty transport to development ONLY. Under NODE_ENV='test' (vitest) a
  // transport worker thread leaks open handles; and prod has no dev deps.
  if (process.env.NODE_ENV === 'development') {
    try {
      return pino({ level, transport: { target: 'pino-pretty', options: { colorize: true } } })
    } catch {
      // pino-pretty absent or transport failed — fall through to plain JSON.
    }
  }
  return pino({ level })
}

export const logger: Logger = createLogger()

export function serializeError(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack }
  return { message: String(err) }
}

export function logError(context: Record<string, unknown>, err: unknown): void {
  logger.error({ ...context, err: serializeError(err) })
}
