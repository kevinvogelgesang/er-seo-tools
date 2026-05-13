// lib/ada-audit/pdf-worker-pool.ts
//
// Concurrency limiter for PDF scans. Lives outside the browser pool because
// pdfjs is pure Node — no Chrome cost.

const POOL_SIZE = parseInt(process.env.PDF_POOL_SIZE ?? '4', 10)

let slots = POOL_SIZE
const waitQueue: Array<() => void> = []

async function acquire(): Promise<void> {
  if (slots > 0) { slots--; return }
  await new Promise<void>((resolve) => waitQueue.push(resolve))
}

function release(): void {
  const next = waitQueue.shift()
  if (next) next()
  else slots++
}

/** Run `fn` once a PDF slot is available. Returns whatever fn returns. */
export async function withPdfSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
