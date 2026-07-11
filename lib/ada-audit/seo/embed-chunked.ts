// lib/ada-audit/seo/embed-chunked.ts
// C12 Tier-1: cooperative chunked embedding. @xenova/transformers runs ONNX
// inference synchronously on the JS thread, so one large embedTexts call can
// block the event loop past the reserve and delay the job-worker heartbeat/timeout
// (the pdfjs event-loop-starvation incident is the cautionary tale). This splits
// the work into bounded chunks with an event-loop yield + deadline check between
// them, abandoning to null (no partial result) if the deadline passes.
export interface EmbedChunkedDeps {
  embed: (texts: string[]) => Promise<number[][]>
  yieldFn?: () => Promise<void>
  shouldAbort?: () => boolean
  chunkSize?: number
}

const defaultYield = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))

export async function embedChunked(texts: string[], deps: EmbedChunkedDeps): Promise<number[][] | null> {
  const chunkSize = deps.chunkSize ?? 32
  const yieldFn = deps.yieldFn ?? defaultYield
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += chunkSize) {
    if (deps.shouldAbort?.()) return null
    const chunk = texts.slice(i, i + chunkSize)
    const vecs = await deps.embed(chunk)
    for (const v of vecs) out.push(v)
    if (i + chunkSize < texts.length) await yieldFn()
  }
  return out
}
