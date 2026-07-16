// Tiny shared helpers for the viewbook admin routes.

import { HttpError } from '@/lib/api/errors'

// Strict positive-int id parse; anything else is an indistinguishable 404.
export function parseId(raw: string): number {
  if (!/^[1-9][0-9]*$/.test(raw)) throw new HttpError(404, 'not_found')
  return parseInt(raw, 10)
}

// Valid JSON that isn't an object (null, "x", 7, []) must be a 400, not a
// 500 from `in`/property access on a primitive (Codex review finding).
export function requireJsonObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_request')
  }
  return body as Record<string, unknown>
}

// Multipart helper: the single 'file' entry as a Buffer, capped upstream by
// the asset store's 2 MB sniff gate.
export async function fileBufferFromForm(form: FormData): Promise<Buffer> {
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'invalid_upload')
  return Buffer.from(await file.arrayBuffer())
}
