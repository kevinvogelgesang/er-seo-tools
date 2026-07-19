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
  collapsedShared: boolean
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
  defKey: string | null // code-owned catalog key; null = custom field (mirrors isCustom)
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
  description: string | null
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
  pcIntro: string | null // plain bounded string (PR5), not a block list — see global-content.ts
  blocks: Partial<Record<Exclude<GlobalContentKey, 'team' | 'pc-intro'>, ContentBlocks | null>>
}

// PR5 pc-invite roster row for the public payload. `invited` is EXISTENCE-only
// (>=1 team-invite delivery row), never send status — see public-data.ts.
// `id` is the numeric ViewbookTeamMember row id (Task 7 addition) — the
// public team-members resend route (team-members.ts `resendInvite`) is keyed
// by numeric `memberId`, not `memberKey`, so the public per-member resend
// button needs it to call that route at all.
export interface PublicTeamMember {
  id: number
  memberKey: string
  name: string
  email: string
  invited: boolean
}

export interface PublicDocRow {
  id: number
  title: string
  blurb: string | null
  filename: string
  sortOrder: number
}

// Task 4 (Lane 4): assessment-tab rich-text notes + user-behaviour image
// gallery. Deliberately SEPARATE from `ViewbookPublicData` — mirrors how
// `AssessmentData` (assessment.ts) lives outside the frozen public-payload
// contract; these are consumed by their own loader (assessment-notes.ts),
// not folded into the big page fetch.
export interface PublicAssessmentImage {
  id: number
  filename: string
  sortOrder: number
}

export interface PublicAssessmentNotes {
  generalNotesHtml: string | null
  userBehaviourHtml: string | null
  userBehaviourImages: PublicAssessmentImage[]
}

export interface ViewbookPublicData {
  viewbookId: number
  clientName: string
  displayName: string // spec §7 header derivation: trimmed school-name answer, else clientName
  csmName: string | null
  kind: string // 'new-build' | 'upgrade'
  welcomeNote: string | null
  dataLockedAt: string | null
  theme: ViewbookTheme
  stage: ViewbookStage
  stageLabel: string
  syncVersion: number // PR2 live sync: poll /sync and refetch when it advances
  pcCompletedAt: string | null // post-contract completion stamp; gates pc-thanks visibility
  clientNotifyJson: string[] // who gets stage-change mail (pc-setup UI)
  teamMembers: PublicTeamMember[] // pc-invite roster
  primarySections: PublicSection[] // this stage's primary lineup, visible only, lineup order
  carriedSections: PublicSection[] // this stage's carried lineup, visible only, lineup order
  fieldCategories: PublicFieldCategory[]
  milestones: PublicMilestone[]
  materials: PublicMaterialLink[]
  docs: { global: PublicDocRow[]; own: PublicDocRow[] }
  global: PublicGlobalContent
  overrides: Partial<Record<GlobalContentKey, string>>
}
