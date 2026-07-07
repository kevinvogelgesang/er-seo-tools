// Client helper mirroring app/(app)/seo-parser/page.tsx handleDrop + handleAnalyze:
// upload CSVs in ≤40MB batches (carry the sessionId forward so all files land in
// one session; Nginx caps the body at ~50MB), then trigger the parse. Returns the
// session id for a results redirect.
const MAX_BATCH_BYTES = 40 * 1024 * 1024

function batchFiles(files: File[]): File[][] {
  const batches: File[][] = []
  let current: File[] = []
  let bytes = 0
  for (const f of files) {
    if (current.length > 0 && bytes + f.size > MAX_BATCH_BYTES) {
      batches.push(current); current = []; bytes = 0
    }
    current.push(f); bytes += f.size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export async function uploadAndParse(files: File[]): Promise<{ sessionId: string }> {
  if (files.length === 0) throw new Error('No files selected.')
  let sessionId: string | undefined
  for (const batch of batchFiles(files)) {
    const form = new FormData()
    if (sessionId) form.append('sessionId', sessionId)
    for (const f of batch) form.append('files', f)
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Upload failed.')
    sessionId = data.sessionId
  }
  if (!sessionId) throw new Error('Upload failed.')
  const parseRes = await fetch(`/api/parse/${sessionId}`, { method: 'POST' })
  if (!parseRes.ok) {
    const data = await parseRes.json().catch(() => ({}))
    throw new Error(data.error || 'Parse failed.')
  }
  return { sessionId }
}
