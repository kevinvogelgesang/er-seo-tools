import 'server-only'

import { prisma } from '@/lib/db'
import { canonicalMailbox } from './global-content-keys'
import type { PublicDocRow } from './public-types'
import type { SectionKey, ViewbookTheme } from './theme'
import { parseStoredTheme } from './theme'

const iso = (value: Date | null): string | null => value?.toISOString() ?? null

export interface OperatorSectionData {
  sectionKey: SectionKey
  state: 'hidden' | 'active' | 'done' | 'collapsed'
  doneAt: string | null
  acknowledgedAt: string | null
  introNote: string | null
  narrative: string | null
}

export interface OperatorFieldData {
  id: number
  defKey: string | null
  category: string
  label: string
  fieldType: string
  sortOrder: number
  value: string | null
  version: number
  valueUpdatedBy: string | null
  valueUpdatedAt: string | null
  archivedAt: string | null
  createdAt: string
  amendments: { id: number; value: string; author: string; createdAt: string }[]
}

export interface OperatorMilestoneData {
  id: number
  title: string
  blurb: string | null
  description: string | null
  sortOrder: number
  status: string
  targetDate: string | null
  doneAt: string | null
}

export interface OperatorTeamMemberData {
  id: number
  memberKey: string
  name: string
  email: string
  addedBy: string
  createdAt: string
}

export interface OperatorViewbookData {
  welcomeNote: string | null
  dataLockedAt: string | null
  dataLockedBy: string | null
  theme: ViewbookTheme
  sections: OperatorSectionData[]
  fields: OperatorFieldData[]
  milestones: OperatorMilestoneData[]
  docs: { global: PublicDocRow[]; own: PublicDocRow[] }
  pcCompletedAt: string | null
  clientNotifyEmails: string[]
  teamMembers: OperatorTeamMemberData[]
}

function parseClientNotifyEmails(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.flatMap((value) => {
      const email = canonicalMailbox(value)
      return email ? [email] : []
    }))]
  } catch {
    return []
  }
}

/**
 * Verified-operator-only read model for the public inline layer.
 *
 * This function performs SELECTs only. The public page must call it only
 * after `getOperatorEmailForPublicPage()` returns a verified email; its data
 * must never be loaded or serialized on the anonymous branch.
 */
export async function loadOperatorViewbookData(viewbookId: number): Promise<OperatorViewbookData | null> {
  const [viewbook, globalDocs] = await Promise.all([
    prisma.viewbook.findUnique({
      where: { id: viewbookId },
      select: {
        welcomeNote: true,
        dataLockedAt: true,
        dataLockedBy: true,
        themeJson: true,
        clientNotifyJson: true,
        pcCompletedAt: true,
        sections: { orderBy: { id: 'asc' } },
        fields: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { amendments: { orderBy: { id: 'asc' } } },
        },
        milestones: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        docs: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, title: true, blurb: true, filename: true, sortOrder: true },
        },
        teamMembers: { orderBy: { id: 'asc' } },
      },
    }),
    prisma.viewbookDoc.findMany({
      where: { viewbookId: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true, blurb: true, filename: true, sortOrder: true },
    }),
  ])
  if (!viewbook) return null

  return {
    welcomeNote: viewbook.welcomeNote,
    dataLockedAt: iso(viewbook.dataLockedAt),
    dataLockedBy: viewbook.dataLockedBy,
    theme: parseStoredTheme(viewbook.themeJson),
    sections: viewbook.sections.map((section) => ({
      sectionKey: section.sectionKey as SectionKey,
      state: section.state === 'hidden' || section.state === 'done' || section.state === 'collapsed' ? section.state : 'active',
      doneAt: iso(section.doneAt),
      acknowledgedAt: iso(section.acknowledgedAt),
      introNote: section.introNote,
      narrative: section.narrative,
    })),
    fields: viewbook.fields.map((field) => ({
      id: field.id,
      defKey: field.defKey,
      category: field.category,
      label: field.label,
      fieldType: field.fieldType,
      sortOrder: field.sortOrder,
      value: field.value,
      version: field.version,
      valueUpdatedBy: field.valueUpdatedBy,
      valueUpdatedAt: iso(field.valueUpdatedAt),
      archivedAt: iso(field.archivedAt),
      createdAt: field.createdAt.toISOString(),
      amendments: field.amendments.map((amendment) => ({
        id: amendment.id,
        value: amendment.value,
        author: amendment.author,
        createdAt: amendment.createdAt.toISOString(),
      })),
    })),
    milestones: viewbook.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      blurb: milestone.blurb,
      description: milestone.description,
      sortOrder: milestone.sortOrder,
      status: milestone.status,
      targetDate: iso(milestone.targetDate),
      doneAt: iso(milestone.doneAt),
    })),
    docs: { global: globalDocs, own: viewbook.docs },
    pcCompletedAt: iso(viewbook.pcCompletedAt),
    clientNotifyEmails: parseClientNotifyEmails(viewbook.clientNotifyJson),
    teamMembers: viewbook.teamMembers.map((member) => ({
      id: member.id,
      memberKey: member.memberKey,
      name: member.name,
      email: member.email,
      addedBy: member.addedBy,
      createdAt: member.createdAt.toISOString(),
    })),
  }
}
