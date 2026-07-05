import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { HttpError } from './errors'

export function withRoute<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (err) {
      // A handler may throw an already-formed Response (e.g. a redirect); honor it.
      if (err instanceof Response) return err
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.code }, { status: err.status })
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return NextResponse.json({ error: 'not_found' }, { status: 404 })
        if (err.code === 'P2002') return NextResponse.json({ error: 'conflict' }, { status: 409 })
      }
      console.error('[api] unhandled route error', err)
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
  }
}
