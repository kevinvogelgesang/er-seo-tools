import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { parseJsonBody } from './body'

describe('parseJsonBody', () => {
  it('parses a valid JSON body', async () => {
    const req = new NextRequest('http://localhost/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    })
    expect(await parseJsonBody<{ a: number }>(req)).toEqual({ a: 1 })
  })
  it('throws HttpError(400, invalid_json) on malformed body', async () => {
    const req = new NextRequest('http://localhost/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
    })
    await expect(parseJsonBody(req)).rejects.toMatchObject({ status: 400, code: 'invalid_json' })
  })
})
