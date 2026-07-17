// Tiny shared helpers for the viewbook admin routes.

import type { NextRequest } from 'next/server'
import { HttpError } from '@/lib/api/errors'

// Reject an oversize (or missing/non-numeric) declared Content-Length BEFORE
// the route buffers the body (request.formData() itself buffers). Callers
// pass their own cap plus multipart boundary slack — the doc routes and the
// image routes have distinct byte ceilings (MAX_DOC_BYTES vs MAX_ASSET_BYTES).
export function requireBoundedContentLength(request: NextRequest, maxBytes: number): void {
  const raw = request.headers.get('content-length')
  if (!raw || !/^[0-9]+$/.test(raw) || Number(raw) > maxBytes) {
    throw new HttpError(413, 'payload_too_large')
  }
}

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

// Multipart helper: validate File.size before arrayBuffer() when a route has
// an allocation cap. Routes must still bound the multipart body before
// request.formData(), because formData() itself buffers the request.
export async function fileBufferFromForm(form: FormData, maxBytes?: number): Promise<Buffer> {
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'invalid_upload')
  if (maxBytes != null && file.size > maxBytes) throw new HttpError(413, 'payload_too_large')
  return Buffer.from(await file.arrayBuffer())
}
