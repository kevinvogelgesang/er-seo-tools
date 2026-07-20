import { describe, it, expect, afterAll } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { setSectionCollapsedShared } from './collapse'

const PREFIX = 'vb-test-collapse-'

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const created = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  return { client, id: created.id, token: created.token }
}

async function sync(id: number) {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id } })).syncVersion
}

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('setSectionCollapsedShared', () => {
  it('any caller can set collapsed=true; bumps syncVersion', async () => {
    const vb = await mkViewbook()
    const before = await sync(vb.id)
    const r = await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false })
    expect(r.collapsedShared).toBe(true)
    expect(await sync(vb.id)).toBe(before + 1)
  })

  it('anonymous collapsed=false is rejected 403 operator_required', async () => {
    const vb = await mkViewbook()
    await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false })
    await expect(setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: false, isOperator: false }))
      .rejects.toMatchObject({ status: 403, code: 'operator_required' })
  })

  it('operator collapsed=false succeeds', async () => {
    const vb = await mkViewbook()
    await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false })
    const r = await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: false, isOperator: true })
    expect(r.collapsedShared).toBe(false)
  })

  it('bookend sections (pc-intro/pc-thanks) are collapsible like any other section (2026-07-19 welcome-auto-reveal)', async () => {
    const vb = await mkViewbook()
    for (const sectionKey of ['pc-intro', 'pc-thanks'] as const) {
      const before = await sync(vb.id)
      const r = await setSectionCollapsedShared(vb, vb.token, { sectionKey, collapsed: true, isOperator: true })
      expect(r.collapsedShared).toBe(true)
      expect(await sync(vb.id)).toBe(before + 1)
    }
  })

  it('an unknown sectionKey is rejected 400 invalid_section', async () => {
    const vb = await mkViewbook()
    await expect(setSectionCollapsedShared(vb, vb.token, { sectionKey: 'not-a-real-section', collapsed: true, isOperator: true }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_section' })
  })

  it('idempotent no-op set does NOT bump syncVersion', async () => {
    const vb = await mkViewbook()
    await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false })
    const before = await sync(vb.id)
    await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false })
    expect(await sync(vb.id)).toBe(before) // value unchanged → no bump
  })

  it('a hidden section is blocked (409) and does not bump syncVersion', async () => {
    const vb = await mkViewbook()
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: vb.id, sectionKey: 'brand' } },
      data: { state: 'hidden' },
    })
    const before = await sync(vb.id)
    await expect(setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false }))
      .rejects.toMatchObject({ status: 409, code: 'collapse_blocked' })
    expect(await sync(vb.id)).toBe(before)
  })

  it('a rotated token is blocked (409) and does not bump syncVersion', async () => {
    const vb = await mkViewbook()
    const before = await sync(vb.id)
    await expect(setSectionCollapsedShared(vb, 'stale-token-value', { sectionKey: 'brand', collapsed: true, isOperator: false }))
      .rejects.toMatchObject({ status: 409, code: 'collapse_blocked' })
    expect(await sync(vb.id)).toBe(before)
  })

  it('a revoked viewbook is blocked (409) and does not bump syncVersion', async () => {
    const vb = await mkViewbook()
    await prisma.viewbook.update({ where: { id: vb.id }, data: { revokedAt: new Date() } })
    const before = await sync(vb.id)
    await expect(setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false }))
      .rejects.toMatchObject({ status: 409, code: 'collapse_blocked' })
    expect(await sync(vb.id)).toBe(before)
  })

  it('an archived client is blocked (409) and does not bump syncVersion', async () => {
    const vb = await mkViewbook()
    await prisma.client.update({ where: { id: vb.client.id }, data: { archivedAt: new Date() } })
    const before = await sync(vb.id)
    await expect(setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false }))
      .rejects.toMatchObject({ status: 409, code: 'collapse_blocked' })
    expect(await sync(vb.id)).toBe(before)
  })
})
