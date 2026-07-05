import type { NextRequest } from 'next/server'
import { HttpError } from './errors'

export async function parseJsonBody<T = unknown>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}
