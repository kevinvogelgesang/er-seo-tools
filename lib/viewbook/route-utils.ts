// Tiny shared helpers for the viewbook admin routes.

import { HttpError } from '@/lib/api/errors'

// Strict positive-int id parse; anything else is an indistinguishable 404.
export function parseId(raw: string): number {
  if (!/^[1-9][0-9]*$/.test(raw)) throw new HttpError(404, 'not_found')
  return parseInt(raw, 10)
}

// Multipart helper: the single 'file' entry as a Buffer, capped upstream by
// the asset store's 2 MB sniff gate.
export async function fileBufferFromForm(form: FormData): Promise<Buffer> {
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'invalid_upload')
  return Buffer.from(await file.arrayBuffer())
}
