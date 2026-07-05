import { describe, it, expect, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { withRoute } from './with-route'
import { HttpError } from './errors'

function prismaKnown(code: string) {
  return new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '5' } as never)
}

describe('withRoute', () => {
  it('passes a normal Response through unchanged', async () => {
    const wrapped = withRoute(async () => NextResponse.json({ ok: true }, { status: 201 }))
    const res = await wrapped()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
  })
  it('maps HttpError to its status + code', async () => {
    const res = await withRoute(async () => { throw new HttpError(404, 'not_found') })()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })
  it('maps Prisma P2025 -> 404 not_found', async () => {
    const res = await withRoute(async () => { throw prismaKnown('P2025') })()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })
  it('maps Prisma P2002 -> 409 conflict', async () => {
    const res = await withRoute(async () => { throw prismaKnown('P2002') })()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('conflict')
  })
  it('passes a THROWN Response through unchanged', async () => {
    const res = await withRoute(async () => { throw NextResponse.json({ x: 1 }, { status: 302 }) })()
    expect(res.status).toBe(302)
    expect(await res.json()).toEqual({ x: 1 })
  })
  it('maps an unknown throw -> 500 internal_error with no message leak', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await withRoute(async () => { throw new Error('secret detail') })()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('internal_error')
    expect(JSON.stringify(body)).not.toContain('secret detail')
    spy.mockRestore()
  })
  it('passes ctx args through to the handler', async () => {
    const wrapped = withRoute(async (_req: unknown, ctx: { params: Promise<{ id: string }> }) => {
      const { id } = await ctx.params
      return NextResponse.json({ id })
    })
    const res = await wrapped({} as never, { params: Promise.resolve({ id: '7' }) })
    expect((await res.json()).id).toBe('7')
  })
})
