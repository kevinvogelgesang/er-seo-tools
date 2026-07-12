import { withRoute } from '@/lib/api/with-route'
import { subscribeBus, BusFullError, type Subscriber } from '@/lib/events/bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const CONNECTION_LIFETIME_MS = 30 * 60_000

export const GET = withRoute(async (request: Request): Promise<Response> => {
  const encoder = new TextEncoder()
  let dispose: (() => void) | null = null
  let lifetime: ReturnType<typeof setTimeout> | null = null

  // ReadableStream.start() runs synchronously, so we can detect over-cap during
  // construction and return a real 503 instead of the stream (Codex plan-fix 3).
  let overCap = false
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller
      const sub: Subscriber = {
        write: (f) => controller.enqueue(encoder.encode(f)),
        close: () => { try { controller.close() } catch { /* already closed */ } },
        desiredSize: () => controller.desiredSize,
      }
      try {
        dispose = subscribeBus(sub)
      } catch (e) {
        if (e instanceof BusFullError) { overCap = true; return }
        throw e
      }
      controller.enqueue(encoder.encode('retry: 5000\nevent: connected\ndata: {}\n\n'))
      lifetime = setTimeout(cleanup, CONNECTION_LIFETIME_MS)
      request.signal.addEventListener('abort', cleanup)
    },
    cancel() { cleanup() },
  })

  // Idempotent: unsubscribe AND close the controller (lifetime-expiry must not
  // leave a heartbeat-free open stream — Codex plan-fix 3).
  function cleanup() {
    if (lifetime) { clearTimeout(lifetime); lifetime = null }
    if (dispose) { dispose(); dispose = null }
    if (ctrl) { try { ctrl.close() } catch { /* already closed */ } ctrl = null }
  }

  if (overCap) {
    cleanup()
    return new Response(null, { status: 503, headers: { 'Retry-After': '5' } })
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
})
