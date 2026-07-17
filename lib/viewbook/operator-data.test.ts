import crypto from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { DEFAULT_THEME } from './theme'
import { loadOperatorViewbookData } from './operator-data'

const PREFIX = 'vb-operator-data-'

afterAll(async () => {
  await prisma.viewbookDoc.deleteMany({ where: { viewbookId: null, title: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('loadOperatorViewbookData', () => {
  it('returns null for an unknown viewbook', async () => {
    expect(await loadOperatorViewbookData(999_999_999)).toBeNull()
  })

  it('returns hidden sections and the complete editor-shaped read model', async () => {
    const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
    const created = await createViewbook(client.id, 'upgrade', 'operator@example.com')
    const pcCompletedAt = new Date('2026-07-16T12:00:00.000Z')
    const theme = { ...DEFAULT_THEME, primary: '#123456' }
    await prisma.viewbook.update({
      where: { id: created.id },
      data: {
        welcomeNote: 'Welcome from ER',
        themeJson: JSON.stringify(theme),
        pcCompletedAt,
        clientNotifyJson: JSON.stringify(['client@example.com']),
      },
    })
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: created.id, sectionKey: 'strategy' } },
      data: { state: 'hidden', introNote: 'Hidden intro' },
    })
    const field = await prisma.viewbookField.findFirstOrThrow({ where: { viewbookId: created.id } })
    await prisma.viewbookField.update({ where: { id: field.id }, data: { value: 'Answer', version: 3 } })
    await prisma.viewbookFieldAmendment.create({
      data: { fieldId: field.id, value: 'Suggested answer', author: 'operator@example.com' },
    })
    await prisma.viewbookDoc.create({
      data: {
        viewbookId: created.id,
        title: `${PREFIX}strategy`,
        filename: 'strategy.pdf',
        sortOrder: 1,
        createdBy: 'operator@example.com',
      },
    })
    await prisma.viewbookTeamMember.create({
      data: {
        viewbookId: created.id,
        memberKey: crypto.randomUUID(),
        name: 'Client Teammate',
        email: 'client@example.com',
        addedBy: 'operator@example.com',
      },
    })

    const data = await loadOperatorViewbookData(created.id)
    expect(data).not.toBeNull()
    expect(data?.welcomeNote).toBe('Welcome from ER')
    expect(data?.theme.primary).toBe('#123456')
    expect(data?.pcCompletedAt).toBe(pcCompletedAt.toISOString())
    expect(data?.clientNotifyEmails).toEqual(['client@example.com'])
    expect(data?.sections.find((section) => section.sectionKey === 'strategy')).toMatchObject({
      state: 'hidden',
      introNote: 'Hidden intro',
    })
    expect(data?.docs.own.map((doc) => doc.title)).toContain(`${PREFIX}strategy`)
    expect(data?.fields.find((item) => item.id === field.id)).toMatchObject({
      value: 'Answer',
      version: 3,
    })
    expect(data?.fields.find((item) => item.id === field.id)?.amendments[0].value).toBe('Suggested answer')
    expect(data?.milestones.length).toBeGreaterThan(0)
    expect(data?.teamMembers[0]).toMatchObject({ name: 'Client Teammate', email: 'client@example.com' })
  })
})
