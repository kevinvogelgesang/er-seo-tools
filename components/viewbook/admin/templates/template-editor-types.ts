// Client-safe mirror of lib/viewbook/template-service.ts's TemplateSectionView
// tree (F1b Task 9). template-service.ts itself is server-only (imports
// prisma/HttpError) so this file re-declares the SHAPES the GET tree crosses
// the client/server boundary as JSON — it reuses the actual client-safe
// validators/constants from their real homes wherever one exists, so caps and
// key patterns can't drift from the server that enforces them.
import type { TeamMember, ContentBlocks } from '@/lib/viewbook/global-content-keys'
import { FIELD_KEY_RE, SUBSECTION_COPY_CAPS } from '@/lib/viewbook/template-content'
import { CAPS as SECTION_COPY_CAPS } from '@/lib/viewbook/section-copy-validator'

export type { TeamMember, ContentBlocks }
export { FIELD_KEY_RE, SUBSECTION_COPY_CAPS, SECTION_COPY_CAPS }

export type ContentKind = 'welcome' | 'strategy' | 'milestones' | 'pc-intro' | 'generic' | 'none'

export interface SectionCopyContent {
  purpose: string
  whatThis: string
  whatWeNeed: string | null
}

export interface SubsectionCopyContent {
  intro: string | null
  whatWeNeed: string | null
}

// The decoded content envelope, keyed by contentKind. 'welcome'/'strategy'/
// 'milestones'/'pc-intro' carry the server's `v: 1` envelope marker verbatim
// (GET returns the parsed object as-is); 'generic' double-nests its payload
// under `blocks` (template-service.ts's contentKindFor comment — the ONE
// spot this asymmetry is documented). PATCH bodies below never send `v`.
export interface WelcomeContent { v: 1; team: TeamMember[]; process: ContentBlocks; why: ContentBlocks }
export interface StrategyContent { v: 1; seoBase: ContentBlocks; geoBase: ContentBlocks; eeatBase: ContentBlocks }
export interface MilestonesContent { v: 1; processMilestones: ContentBlocks }
export interface PcIntroContent { v: 1; intro: string }
export interface GenericContent { v: 1; blocks: ContentBlocks }

export type SubsectionContentV1 =
  | WelcomeContent
  | StrategyContent
  | MilestonesContent
  | PcIntroContent
  | GenericContent

export interface TemplateFieldView {
  id: number
  fieldKey: string
  label: string
  fieldType: string
  sortOrder: number
  version: number
  archivedAt: string | null
}

export interface TemplateSubsectionView {
  id: number
  subsectionKey: string
  title: string
  offeringWebsite: boolean
  offeringVa: boolean
  offeringPpc: boolean
  copy: SubsectionCopyContent | null
  content: SubsectionContentV1 | null
  contentKind: ContentKind
  sortOrder: number
  version: number
  archivedAt: string | null
  fields: TemplateFieldView[]
}

export interface TemplateSectionView {
  id: number
  templateKey: string
  rendererType: string
  title: string
  copy: SectionCopyContent | null
  sortOrder: number
  version: number
  archivedAt: string | null
  subsections: TemplateSubsectionView[]
}

export interface TemplateTree {
  sections: TemplateSectionView[]
}

// Labels for the 'strategy' contentKind's three block lists — ported from
// GlobalContentEditor's BLOCK_TITLES (keyed there by the legacy hyphenated
// GlobalContentKey; here by the bridged envelope's own camelCase field name).
export const STRATEGY_BLOCK_TITLES: Record<'seoBase' | 'geoBase' | 'eeatBase', string> = {
  seoBase: 'SEO foundation',
  geoBase: 'GEO foundation',
  eeatBase: 'E-E-A-T foundation',
}

// Helper text shown next to every title/subsection-copy field — F1b's
// bridged template edits render into the CURRENT (F1a) viewbook renderer,
// which does not yet read these fields; F2 is the renderer cutover.
export const F2_HELPER_TEXT = 'applies after template cutover (F2)'
