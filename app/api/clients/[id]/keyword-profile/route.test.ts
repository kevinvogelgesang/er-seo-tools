import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, PATCH } from './route'
import { POST as SUGGEST } from './suggest/route'

let clientId: number
const ids: number[] = []

beforeEach(async () => {
  const c = await prisma.client.create({ data: { name: `ks3-route-${Date.now()}-${Math.random()}` } })
  clientId = c.id
  ids.push(c.id)
})
afterEach(async () => {
  await prisma.crawlRun.deleteMany({ where: { clientId: { in: ids } } })
  await prisma.client.deleteMany({ where: { id: { in: ids } } })
  ids.length = 0
})

const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) })
const patchReq = (body: unknown) =>
  new NextRequest('http://localhost/api/clients/1/keyword-profile', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })

describe('GET keyword-profile', () => {
  it('400 bad id, 404 unknown, empty profile for fresh client', async () => {
    expect((await GET(new NextRequest('http://localhost'), params('abc'))).status).toBe(400)
    expect((await GET(new NextRequest('http://localhost'), params(999999999))).status).toBe(404)
    const res = await GET(new NextRequest('http://localhost'), params(clientId))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      institutionType: null, programs: [], suggestions: null, locale: null, hasLiveScan: false,
    })
  })
})

describe('PATCH keyword-profile', () => {
  it('validation rejections with named codes', async () => {
    const cases: [unknown, string][] = [
      [{ institutionType: 'church' }, 'invalid_institution_type'],
      [{ programs: 'nope' }, 'invalid_programs'],
      [{ programs: [{ name: '' }] }, 'invalid_programs'],
      [{ locale: { locationCode: 2840, languageCode: 'zh-TW' } }, 'invalid_locale'],
      [{ locale: { locationCode: 0, languageCode: 'en' } }, 'invalid_locale'],
      [{ programs: [{ name: 'A' }], confirmSuggestion: 'X' }, 'conflicting_ops'],
      [{ confirmSuggestion: 'X', dismissSuggestion: 'Y' }, 'conflicting_ops'],
      [{ confirmSuggestion: '   ' }, 'invalid_suggestion_name'],
      [{}, 'no_valid_fields'],
      [null, 'invalid_body'],
      [[1, 2], 'invalid_body'],
      ['str', 'invalid_body'],
    ]
    for (const [body, code] of cases) {
      const res = await PATCH(patchReq(body), params(clientId))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(code)
    }
  })
  it('malformed JSON body → 400 invalid_json (parseJsonBody)', async () => {
    const req = new NextRequest('http://localhost/x', {
      method: 'PATCH', body: '{oops', headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, params(clientId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })
  it('happy path sets fields; archived → 409; unknown suggestion → 409', async () => {
    const ok = await PATCH(patchReq({
      institutionType: 'trade',
      programs: [{ name: 'Dental Assisting' }],
      locale: { locationCode: 2840, languageCode: 'EN', marketLabel: 'United States — English' },
    }), params(clientId))
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.locale.languageCode).toBe('en')
    expect(body.programs[0].confirmed).toBe(true)

    expect((await PATCH(patchReq({ confirmSuggestion: 'Nope' }), params(clientId))).status).toBe(409)

    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } })
    const res = await PATCH(patchReq({ institutionType: 'trade' }), params(clientId))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('client_archived')
  })
})

describe('POST suggest', () => {
  it('409 no_live_scan_run without a run; 200 + persisted suggestions with one', async () => {
    const none = await SUGGEST(new NextRequest('http://localhost', { method: 'POST' }), params(clientId))
    expect(none.status).toBe(409)
    expect((await none.json()).error).toBe('no_live_scan_run')

    await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', clientId, status: 'complete',
        programEntitiesJson: JSON.stringify({ v: 1, entities: [{ name: 'Cosmetology', url: 'https://x.edu/c' }] }),
      },
    })
    const res = await SUGGEST(new NextRequest('http://localhost', { method: 'POST' }), params(clientId))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions.suggestions.map((s: { name: string }) => s.name)).toEqual(['Cosmetology'])
  })
})
