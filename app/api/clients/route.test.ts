// A3 Phase 1 characterization: GET/POST /api/clients, AS-IS (warts included).
// Pins the malformed-JSON 500 defect on POST — Task 11 will fix it to 400.
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, POST } from './route'

const PREFIX = '__a3cli__'

function jsonReq(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function rawReq(method: string, rawBody: string): NextRequest {
  return new NextRequest('http://localhost/api/clients', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  })
}

async function clear() {
  await prisma.schedule.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeEach(clear)
afterAll(clear)

describe('GET /api/clients', () => {
  it('200s with an array containing the namespaced fixture', async () => {
    const c = await prisma.client.create({ data: { name: `${PREFIX}list` } })
    const res = await GET(new NextRequest('http://localhost/api/clients'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
    const row = json.find((x: { id: number }) => x.id === c.id)
    expect(row).toBeTruthy()
    expect(row.name).toBe(`${PREFIX}list`)
  })
})

describe('POST /api/clients', () => {
  it('201s with the created client on { name }', async () => {
    const res = await POST(jsonReq('POST', { name: `${PREFIX}create` }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.name).toBe(`${PREFIX}create`)
    expect(json.domains).toEqual([])
    expect(json.seedUrls).toBeNull()
    expect(await prisma.client.count({ where: { id: json.id } })).toBe(1)
  })

  it('400 "name is required" when name is missing', async () => {
    const res = await POST(jsonReq('POST', {}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('name is required')
  })

  it('409 "A client with that name already exists" on duplicate name', async () => {
    await prisma.client.create({ data: { name: `${PREFIX}dupe` } })
    const res = await POST(jsonReq('POST', { name: `${PREFIX}dupe` }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('A client with that name already exists')
  })

  it('pins the current defect: malformed JSON body -> 500 (fixed in a later phase)', async () => {
    const res = await POST(rawReq('POST', '{not json'))
    expect(res.status).toBe(500)
  })
})
