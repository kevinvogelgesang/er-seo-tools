import { afterAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import {
  applyAnswerEdit,
  lockViewbook,
  proposeAmendment,
} from './answers'

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-pr3-' } } })
})

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-test-pr3-${crypto.randomUUID()}` } })
  const created = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  const viewbook = await requireViewbookToken(created.token)
  const textField = await prisma.viewbookField.findFirstOrThrow({
    where: { viewbookId: created.id, fieldType: 'text' },
  })
  const listField = await prisma.viewbookField.findFirstOrThrow({
    where: { viewbookId: created.id, fieldType: 'list' },
  })
  return { client, viewbook, token: created.token, textField, listField }
}

describe('viewbook answer state machine', () => {
  it('edits with a version bump and emits no activity or bump for a no-op', async () => {
    const ctx = await mkViewbook()
    const first = await applyAnswerEdit(ctx.viewbook, ctx.token, {
      fieldId: ctx.textField.id, value: 'First answer', expectedVersion: 0,
    }, 'client')
    expect(first.field).toMatchObject({ value: 'First answer', version: 1, valueUpdatedBy: 'client' })
    expect(first.field.valueUpdatedAt).toBeInstanceOf(Date)

    const noOp = await applyAnswerEdit(ctx.viewbook, ctx.token, {
      fieldId: ctx.textField.id, value: 'First answer', expectedVersion: 1,
    }, 'client')
    expect(noOp.field.version).toBe(1)
    expect(await prisma.viewbookActivity.count({
      where: { viewbookId: ctx.viewbook.id, kind: 'answer' },
    })).toBe(1)
  })

  it('returns stale_version with current truth and rejects cross-viewbook or archived fields', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    await prisma.viewbookField.update({
      where: { id: a.textField.id },
      data: { value: 'Current', version: 3 },
    })
    await expect(applyAnswerEdit(a.viewbook, a.token, {
      fieldId: a.textField.id, value: 'Stale', expectedVersion: 2,
    }, 'client')).rejects.toMatchObject({
      status: 409, code: 'stale_version', current: { value: 'Current', version: 3 },
    })
    await expect(applyAnswerEdit(a.viewbook, a.token, {
      fieldId: b.textField.id, value: 'Cross', expectedVersion: 0,
    }, 'client')).rejects.toMatchObject({ status: 404, code: 'not_found' })
    await prisma.viewbookField.update({ where: { id: a.textField.id }, data: { archivedAt: new Date() } })
    await expect(applyAnswerEdit(a.viewbook, a.token, {
      fieldId: a.textField.id, value: 'Archived', expectedVersion: 3,
    }, 'client')).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('commit-time fences lock-vs-answer and revoke-vs-write races', async () => {
    const locked = await mkViewbook()
    await expect(applyAnswerEdit(locked.viewbook, locked.token, {
      fieldId: locked.textField.id, value: 'Lost race', expectedVersion: 0,
    }, 'client', {
      beforeCommit: () => lockViewbook(locked.viewbook.id, 'operator@example.com').then(() => {}),
    })).rejects.toMatchObject({ status: 409, code: 'data_locked', current: { value: null, version: 0 } })
    expect((await prisma.viewbookField.findUniqueOrThrow({ where: { id: locked.textField.id } })).value).toBeNull()
    expect(await prisma.viewbookActivity.count({
      where: { viewbookId: locked.viewbook.id, kind: 'answer' },
    })).toBe(0)

    const revoked = await mkViewbook()
    await expect(applyAnswerEdit(revoked.viewbook, revoked.token, {
      fieldId: revoked.textField.id, value: 'Must not land', expectedVersion: 0,
    }, 'client', {
      beforeCommit: () => prisma.viewbook.update({
        where: { id: revoked.viewbook.id }, data: { revokedAt: new Date() },
      }).then(() => {}),
    })).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect((await prisma.viewbookField.findUniqueOrThrow({ where: { id: revoked.textField.id } })).value).toBeNull()
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: revoked.viewbook.id } })).toBe(0)
  })

  it('locks once, rejects baseline edits, and keeps post-lock custom fields editable', async () => {
    const ctx = await mkViewbook()
    const first = await lockViewbook(ctx.viewbook.id, 'first@example.com')
    const replay = await lockViewbook(ctx.viewbook.id, 'second@example.com')
    expect(first.alreadyLocked).toBe(false)
    expect(replay).toMatchObject({ alreadyLocked: true, dataLockedBy: 'first@example.com' })
    expect(await prisma.viewbookActivity.count({
      where: { viewbookId: ctx.viewbook.id, kind: 'lock' },
    })).toBe(1)

    await expect(applyAnswerEdit(ctx.viewbook, null, {
      fieldId: ctx.textField.id, value: 'Baseline edit', expectedVersion: 0,
    }, 'operator@example.com')).rejects.toMatchObject({ status: 409, code: 'data_locked' })

    await prisma.viewbook.update({
      where: { id: ctx.viewbook.id }, data: { dataLockedAt: new Date(Date.now() - 1000) },
    })
    const custom = await prisma.viewbookField.create({
      data: {
        viewbookId: ctx.viewbook.id, defKey: null, category: 'school', label: 'Post-lock question',
        fieldType: 'text', sortOrder: 999, createdBy: 'operator@example.com',
      },
    })
    const edited = await applyAnswerEdit(ctx.viewbook, ctx.token, {
      fieldId: custom.id, value: 'Still editable', expectedVersion: 0,
    }, 'client')
    expect(edited.field).toMatchObject({ value: 'Still editable', version: 1 })
  })

  it('validates list values against the stored field type and the 8 KB cap', async () => {
    const ctx = await mkViewbook()
    const list = await applyAnswerEdit(ctx.viewbook, ctx.token, {
      fieldId: ctx.listField.id, value: ['One', 'Two'], expectedVersion: 0,
    }, 'client')
    expect(list.field.value).toBe('["One","Two"]')
    await expect(applyAnswerEdit(ctx.viewbook, ctx.token, {
      fieldId: ctx.listField.id, value: 'not an array', expectedVersion: 1,
    }, 'client')).rejects.toMatchObject({ status: 400, code: 'invalid_answer' })
    await expect(applyAnswerEdit(ctx.viewbook, ctx.token, {
      fieldId: ctx.textField.id, value: ['wrong type'], expectedVersion: 0,
    }, 'client')).rejects.toMatchObject({ status: 400, code: 'invalid_answer' })
    await expect(applyAnswerEdit(ctx.viewbook, ctx.token, {
      fieldId: ctx.textField.id, value: 'x'.repeat(8193), expectedVersion: 0,
    }, 'client')).rejects.toMatchObject({ status: 400, code: 'invalid_answer' })
  })
})

describe('viewbook amendments', () => {
  it('requires a UUID clientMutationId', async () => {
    const ctx = await mkViewbook()
    await lockViewbook(ctx.viewbook.id, 'operator@example.com')
    await expect(proposeAmendment(ctx.viewbook, ctx.token, {
      fieldId: ctx.textField.id, value: 'Invalid replay key', clientMutationId: 'not-a-uuid',
    }, 'client')).rejects.toMatchObject({ status: 400, code: 'invalid_client_mutation_id' })
  })

  it('requires a locked baseline field and replays a mutation id as the same row', async () => {
    const ctx = await mkViewbook()
    const id = crypto.randomUUID()
    await expect(proposeAmendment(ctx.viewbook, ctx.token, {
      fieldId: ctx.textField.id, value: 'Too early', clientMutationId: id,
    }, 'client')).rejects.toMatchObject({ status: 409, code: 'not_locked' })

    await lockViewbook(ctx.viewbook.id, 'operator@example.com')
    const first = await proposeAmendment(ctx.viewbook, ctx.token, {
      fieldId: ctx.textField.id, value: 'Please change this', clientMutationId: id,
    }, 'client')
    const replay = await proposeAmendment(ctx.viewbook, ctx.token, {
      fieldId: ctx.textField.id, value: 'Please change this', clientMutationId: id,
    }, 'client')
    expect(replay.replayed).toBe(true)
    expect(replay.amendment.id).toBe(first.amendment.id)
    expect(await prisma.viewbookActivity.count({
      where: { viewbookId: ctx.viewbook.id, kind: 'amendment' },
    })).toBe(1)
  })

  it('enforces the 20-row cap under Promise.all double-submit', async () => {
    const ctx = await mkViewbook()
    await lockViewbook(ctx.viewbook.id, 'operator@example.com')
    await prisma.viewbookFieldAmendment.createMany({
      data: Array.from({ length: 19 }, (_, i) => ({
        fieldId: ctx.textField.id, value: `seed ${i}`, author: 'client', clientMutationId: crypto.randomUUID(),
      })),
    })
    const results = await Promise.allSettled([0, 1].map((i) => proposeAmendment(ctx.viewbook, ctx.token, {
      fieldId: ctx.textField.id, value: `racing ${i}`, clientMutationId: crypto.randomUUID(),
    }, 'client')))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await prisma.viewbookFieldAmendment.count({ where: { fieldId: ctx.textField.id } })).toBe(20)
    const rejection = results.find((result) => result.status === 'rejected')
    expect(rejection).toMatchObject({ reason: { status: 409, code: 'amendment_limit_reached' } })
  })
})
