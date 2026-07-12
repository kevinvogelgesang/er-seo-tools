// Reads a request body while counting streamed bytes; returns null once the cap
// is exceeded (regardless of Content-Length). Parses JSON only after the whole
// (bounded) body is in hand. Used by the cat_ PATCH route BEFORE token auth so an
// unauthenticated caller can't stream an unbounded body.
export async function readBoundedText(req: Request, maxBytes: number): Promise<string | null> {
  const reader = req.body?.getReader()
  if (!reader) {
    const t = await req.text()
    return Buffer.byteLength(t, 'utf8') > maxBytes ? null : t
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) { await reader.cancel().catch(() => {}); return null }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}
