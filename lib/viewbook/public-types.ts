// Client-safe payload types for the public viewbook page (PR2). The server
// loader (public-data.ts) produces these; every public section component and
// the admin ThemePreview consume them. NO server imports here (the
// global-content-keys.ts precedent) — public-data.ts imports prisma, so
// components must never import types from it directly.

import type { SectionKey, ViewbookTheme } from './theme'
import type { ContentBlocks, GlobalContentKey, TeamMember } from './global-content-keys'
import type { ViewbookStage } from './stages'

export interface PublicSection {
  sectionKey: SectionKey
  state: 'active' | 'done'
  doneAt: string | null
  acknowledgedAt: string | null
  introNote: string | null
  narrative: string | null
}

export interface PublicFieldAmendment {
  id: number
  value: string
  author: string // 'client' | operator email — components display 'you' / 'our team'
  createdAt: string
}

export interface PublicField {
  id: number
  label: string
  fieldType: string // 'text' | 'textarea' | 'list'
  value: string | null // list = JSON array of strings
  version: number // PR3 optimistic-concurrency contract (expectedVersion)
  createdAt: string // PR3 derives "added after lock-in" vs dataLockedAt
  valueUpdatedBy: string | null
  valueUpdatedAt: string | null
  isCustom: boolean
  amendments: PublicFieldAmendment[]
}

export interface PublicFieldCategory {
  category: string
  fields: PublicField[]
}

// Feedback rows ride along read-only in PR2; PR4's FeedbackThread renders them.
export interface PublicFeedback {
  id: number
  body: string
  authorName: string | null
  authorKind: string // 'client' | 'operator'
  resolvedAt: string | null
  createdAt: string
}

export interface PublicReviewLink {
  id: number
  label: string
  url: string
  kind: string // 'mockup' | 'live'
  feedback: PublicFeedback[]
}

export interface PublicMilestone {
  id: number
  title: string
  blurb: string | null
  status: string // 'upcoming' | 'current' | 'done'
  targetDate: string | null
  doneAt: string | null
  reviewLinks: PublicReviewLink[]
}

export interface PublicMaterialLink {
  id: number
  label: string
  status: string // 'requested' | 'provided'
  url: string | null
  addedBy: string // 'client' | operator email
  providedAt: string | null
}

export interface PublicGlobalContent {
  team: TeamMember[] | null
  blocks: Partial<Record<Exclude<GlobalContentKey, 'team'>, ContentBlocks | null>>
}

export interface ViewbookPublicData {
  clientName: string
  kind: string // 'new-build' | 'upgrade'
  welcomeNote: string | null
  dataLockedAt: string | null
  theme: ViewbookTheme
  stage: ViewbookStage
  stageLabel: string
  syncVersion: number // PR2 live sync: poll /sync and refetch when it advances
  primarySections: PublicSection[] // this stage's primary lineup, visible only, lineup order
  carriedSections: PublicSection[] // this stage's carried lineup, visible only, lineup order
  fieldCategories: PublicFieldCategory[]
  milestones: PublicMilestone[]
  materials: PublicMaterialLink[]
  global: PublicGlobalContent
  overrides: Partial<Record<GlobalContentKey, string>>
}
