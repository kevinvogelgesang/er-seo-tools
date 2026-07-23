import crypto from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { requireViewbookToken } from './route-auth'
import { hashSecret } from './auth-secrets'
import type { PublicMutationAuth } from './principal'
import { insertClientFeedback, insertClientMaterial } from './public-writes'
import { applyAnswerEdit, lockViewbook, proposeAmendment } from './answers'
import { acknowledgeSection } from './ack'
import { setNotifyEmails } from './setup'
import { addTeamMember, resendInvite } from './team-members'

vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(async () => ({ id: 'member-auth-job', deduped: false })) }
})

const PREFIX = 'vb-member-mutation-auth-'

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

async function seed() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const created = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  await prisma.viewbook.update({ where: { id: created.id }, data: { stage: 'post-contract' } })
  const viewbook = await requireViewbookToken(created.token)
  const field = await prisma.viewbookField.findFirstOrThrow({
    where: { viewbookId: viewbook.id, fieldType: 'text' },
  })
  const milestone = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: viewbook.id } })
  const reviewLink = await prisma.viewbookReviewLink.create({
    data: {
      milestoneId: milestone.id,
      label: 'Member review target',
      url: 'https://example.com/review',
      kind: 'live',
      createdBy: 'operator@example.com',
    },
  })
  return { client, viewbook, token: created.token, field, reviewLink }
}

async function memberAuth(viewbookId: number): Promise<{ auth: PublicMutationAuth; memberId: number }> {
  const member = await prisma.viewbookTeamMember.create({
    data: {
      viewbookId,
      memberKey: crypto.randomUUID(),
      name: 'Jamie Member',
      email: `jamie-${crypto.randomUUID()}@example.com`,
      addedBy: 'operator@example.com',
    },
  })
  const session = await prisma.viewbookMemberSession.create({
    data: {
      memberId: member.id,
      tokenHash: hashSecret(crypto.randomBytes(32).toString('base64url')),
      expiresAt: new Date(Date.now() + 60_000),
    },
  })
  return {
    memberId: member.id,
    auth: {
      principal: {
        kind: 'member',
        member: { id: member.id, memberKey: member.memberKey, name: member.name, email: member.email },
        sessionId: session.id,
      },
    },
  }
}

async function removeActor(memberId: number) {
  await prisma.viewbookTeamMember.delete({ where: { id: memberId } })
}

describe('member mutation attribution', () => {
  it('writes member identity and durable actor kinds across public cores', async () => {
    const ctx = await seed()
    const actor = await memberAuth(ctx.viewbook.id)
    const principal = actor.auth.principal
    if (principal.kind !== 'member') throw new Error('test principal must be a member')

    await applyAnswerEdit(ctx.viewbook, ctx.token, {
      fieldId: ctx.field.id,
      value: 'Member answer',
      expectedVersion: 0,
    }, actor.auth)
    await lockViewbook(ctx.viewbook.id, 'operator@example.com')
    const amendment = await proposeAmendment(ctx.viewbook, ctx.token, {
      fieldId: ctx.field.id,
      value: 'Member amendment',
      clientMutationId: crypto.randomUUID(),
    }, actor.auth)
    const feedback = await insertClientFeedback(ctx.viewbook, ctx.token, {
      reviewLinkId: ctx.reviewLink.id,
      body: 'Member feedback',
      authorName: 'Spoofed Name',
      clientMutationId: crypto.randomUUID(),
    }, actor.auth)
    const material = await insertClientMaterial(ctx.viewbook, ctx.token, {
      label: 'Member material',
      url: 'https://example.com/member-material',
      clientMutationId: crypto.randomUUID(),
    }, actor.auth)
    const added = await addTeamMember(ctx.viewbook, ctx.token, {
      name: 'Second Member',
      email: `second-${crypto.randomUUID()}@example.com`,
      clientMutationId: crypto.randomUUID(),
    }, actor.auth)
    await setNotifyEmails(ctx.viewbook, ctx.token, {
      notifyEmails: [added.member.email],
      clientMutationId: crypto.randomUUID(),
    }, actor.auth)
    await acknowledgeSection(ctx.viewbook, ctx.token, {
      sectionKey: 'pc-setup',
      clientMutationId: crypto.randomUUID(),
    }, actor.auth)

    const field = await prisma.viewbookField.findUniqueOrThrow({ where: { id: ctx.field.id } })
    expect(field).toMatchObject({
      valueUpdatedBy: principal.member.email,
      valueUpdatedByKind: 'member',
    })
    expect(amendment.amendment).toMatchObject({ author: principal.member.name, authorKind: 'member' })
    expect(feedback.feedback).toMatchObject({ authorName: principal.member.name, authorKind: 'client' })
    expect(material.material).toMatchObject({ addedBy: principal.member.email, addedByKind: 'member' })
    expect(added.member.addedBy).toBe(principal.member.email)

    const activities = await prisma.viewbookActivity.findMany({
      where: { viewbookId: ctx.viewbook.id, actorKind: 'member' },
    })
    expect(activities.map((row) => row.kind)).toEqual(expect.arrayContaining([
      'answer', 'amendment', 'feedback', 'material-link', 'team-invite-add', 'notify-emails-set', 'section-ack',
    ]))
    expect(activities.every((row) => row.actor === principal.member.email)).toBe(true)
  })

  it('ignores claimed feedback authorship for operator principals too', async () => {
    const ctx = await seed()
    const auth: PublicMutationAuth = { principal: { kind: 'operator', email: 'verified@example.com' } }
    const result = await insertClientFeedback(ctx.viewbook, ctx.token, {
      reviewLinkId: ctx.reviewLink.id,
      body: 'Operator feedback',
      authorName: 'Claimed Client',
      clientMutationId: crypto.randomUUID(),
    }, auth)
    expect(result.feedback).toMatchObject({ authorName: 'verified@example.com', authorKind: 'operator' })
  })
})

describe('member commit-time removal fences', () => {
  it('blocks a fresh write when the member disappears immediately before commit', async () => {
    const ctx = await seed()
    const actor = await memberAuth(ctx.viewbook.id)
    const clientMutationId = crypto.randomUUID()
    await expect(insertClientMaterial(ctx.viewbook, ctx.token, {
      label: 'Must not land',
      url: 'https://example.com/blocked',
      clientMutationId,
    }, actor.auth, {
      beforeCommit: () => removeActor(actor.memberId),
    })).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(await prisma.viewbookMaterialLink.count({ where: { clientMutationId } })).toBe(0)
  })

  it('blocks resend when the actor member disappears immediately before commit', async () => {
    const ctx = await seed()
    const actor = await memberAuth(ctx.viewbook.id)
    const target = await prisma.viewbookTeamMember.create({
      data: {
        viewbookId: ctx.viewbook.id,
        memberKey: crypto.randomUUID(),
        name: 'Resend Target',
        email: `${crypto.randomUUID()}@example.com`,
        addedBy: 'operator@example.com',
      },
    })
    const before = await prisma.viewbookEmailDelivery.count({ where: { memberId: target.id } })
    await expect(resendInvite(ctx.viewbook, ctx.token, { memberId: target.id }, actor.auth, {
      beforeCommit: () => removeActor(actor.memberId),
    })).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(await prisma.viewbookEmailDelivery.count({ where: { memberId: target.id } })).toBe(before)
  })
})

describe('removed members cannot receive replay or no-op success', () => {
  it('blocks answer value-idempotent replay', async () => {
    const ctx = await seed()
    const actor = await memberAuth(ctx.viewbook.id)
    await applyAnswerEdit(ctx.viewbook, ctx.token, {
      fieldId: ctx.field.id, value: 'Same value', expectedVersion: 0,
    }, actor.auth)
    await removeActor(actor.memberId)
    await expect(applyAnswerEdit(ctx.viewbook, ctx.token, {
      fieldId: ctx.field.id, value: 'Same value', expectedVersion: 1,
    }, actor.auth)).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('blocks amendment clientMutationId replay', async () => {
    const ctx = await seed()
    const actor = await memberAuth(ctx.viewbook.id)
    await lockViewbook(ctx.viewbook.id, 'operator@example.com')
    const input = { fieldId: ctx.field.id, value: 'Replay', clientMutationId: crypto.randomUUID() }
    await proposeAmendment(ctx.viewbook, ctx.token, input, actor.auth)
    await removeActor(actor.memberId)
    await expect(proposeAmendment(ctx.viewbook, ctx.token, input, actor.auth)).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('blocks feedback and material clientMutationId replay', async () => {
    const ctx = await seed()
    const actor = await memberAuth(ctx.viewbook.id)
    const feedback = {
      reviewLinkId: ctx.reviewLink.id,
      body: 'Replay feedback',
      authorName: null,
      clientMutationId: crypto.randomUUID(),
    }
    const material = {
      label: 'Replay material',
      url: 'https://example.com/replay',
      clientMutationId: crypto.randomUUID(),
    }
    await insertClientFeedback(ctx.viewbook, ctx.token, feedback, actor.auth)
    await insertClientMaterial(ctx.viewbook, ctx.token, material, actor.auth)
    await removeActor(actor.memberId)
    await expect(insertClientFeedback(ctx.viewbook, ctx.token, feedback, actor.auth)).rejects.toMatchObject({ status: 404, code: 'not_found' })
    await expect(insertClientMaterial(ctx.viewbook, ctx.token, material, actor.auth)).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('blocks already-acked and setup value-idempotent no-ops', async () => {
    const ctx = await seed()
    const actor = await memberAuth(ctx.viewbook.id)
    const recipient = await prisma.viewbookTeamMember.create({
      data: {
        viewbookId: ctx.viewbook.id,
        memberKey: crypto.randomUUID(),
        name: 'Notify Recipient',
        email: `${crypto.randomUUID()}@example.com`,
        addedBy: 'operator@example.com',
      },
    })
    await acknowledgeSection(ctx.viewbook, ctx.token, {
      sectionKey: 'pc-setup', clientMutationId: crypto.randomUUID(),
    }, actor.auth)
    await setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: [recipient.email] }, actor.auth)
    await removeActor(actor.memberId)
    await expect(acknowledgeSection(ctx.viewbook, ctx.token, {
      sectionKey: 'pc-setup', clientMutationId: crypto.randomUUID(),
    }, actor.auth)).rejects.toMatchObject({ status: 404, code: 'not_found' })
    await expect(setNotifyEmails(ctx.viewbook, ctx.token, { notifyEmails: [recipient.email] }, actor.auth))
      .rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('blocks team-add clientMutationId replay', async () => {
    const ctx = await seed()
    const actor = await memberAuth(ctx.viewbook.id)
    const input = {
      name: 'Replay Invitee',
      email: `${crypto.randomUUID()}@example.com`,
      clientMutationId: crypto.randomUUID(),
    }
    await addTeamMember(ctx.viewbook, ctx.token, input, actor.auth)
    await removeActor(actor.memberId)
    await expect(addTeamMember(ctx.viewbook, ctx.token, input, actor.auth))
      .rejects.toMatchObject({ status: 404, code: 'not_found' })
  })
})
