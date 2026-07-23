// Client-safe versioned envelope parsers + legacy translators (F1a Task 5,
// Codex plan-fix #10). Template JSON columns always carry `{v:1, ...}`
// envelopes with strict whole-doc-reject parsers (ingest-schema.ts
// convention: ANY deviation from the exact expected shape → null, never
// partial). The `toLegacy*` translators turn a parsed envelope back into the
// exact shape the legacy global-content / section-copy stores already
// expect — F1b's dual-write bridge rests on these staying render-identical.
// Pure + client-safe: no prisma/db/HttpError/sync imports.
import { isPlainObject, validateTeam, validateBlocks, validatePcIntro } from './content-validators'
import { validateSectionCopy, type SectionCopyContent } from './section-copy-validator'
import type { ContentBlocks, TeamMember, GlobalContentKey } from './global-content-keys'

export const FIELD_KEY_RE = /^[a-z0-9][a-z0-9-]{1,63}$/

export interface TemplateCopyV1 { v: 1; copy: SectionCopyContent }

export type SubsectionContentV1 =
  | { v: 1; team: TeamMember[]; process: ContentBlocks; why: ContentBlocks }      // welcome/main
  | { v: 1; seoBase: ContentBlocks; geoBase: ContentBlocks; eeatBase: ContentBlocks } // strategy/main
  | { v: 1; processMilestones: ContentBlocks }                                     // milestones/main
  | { v: 1; intro: string }                                                        // pc-intro/main
  | { v: 1; blocks: ContentBlocks }                                                // generic

// Shared envelope gate: parse JSON, require a plain object, require v === 1.
// Returns the raw parsed object (still un-validated beyond that) or null.
function parseEnvelope(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  if (parsed.v !== 1) return null
  return parsed
}

export function parseTemplateCopy(raw: string | null): TemplateCopyV1 | null {
  const parsed = parseEnvelope(raw)
  if (parsed === null) return null
  if (Object.keys(parsed).length !== 2) return null
  const copy = validateSectionCopy(parsed.copy)
  if (copy === null) return null
  return { v: 1, copy }
}

export function parseSubsectionContent(rendererType: string, raw: string | null): SubsectionContentV1 | null {
  const parsed = parseEnvelope(raw)
  if (parsed === null) return null
  const keys = Object.keys(parsed)
  switch (rendererType) {
    case 'welcome': {
      if (keys.length !== 4) return null
      const team = validateTeam(parsed.team)
      const process = validateBlocks(parsed.process)
      const why = validateBlocks(parsed.why)
      if (team === null || process === null || why === null) return null
      return { v: 1, team, process, why }
    }
    case 'strategy': {
      if (keys.length !== 4) return null
      const seoBase = validateBlocks(parsed.seoBase)
      const geoBase = validateBlocks(parsed.geoBase)
      const eeatBase = validateBlocks(parsed.eeatBase)
      if (seoBase === null || geoBase === null || eeatBase === null) return null
      return { v: 1, seoBase, geoBase, eeatBase }
    }
    case 'milestones': {
      if (keys.length !== 2) return null
      const processMilestones = validateBlocks(parsed.processMilestones)
      if (processMilestones === null) return null
      return { v: 1, processMilestones }
    }
    case 'pc-intro': {
      if (keys.length !== 2) return null
      const intro = validatePcIntro(parsed.intro)
      if (intro === null) return null
      return { v: 1, intro }
    }
    case 'generic': {
      if (keys.length !== 2) return null
      const blocks = validateBlocks(parsed.blocks)
      if (blocks === null) return null
      return { v: 1, blocks }
    }
    default:
      // Every other rendererType — a known-but-contentless renderer (e.g.
      // 'brand', 'data-source', 'pc-setup', ...) or an entirely unrecognized
      // string — has no defined subsection-content shape in F1. Any non-null
      // content for one is a corruption/mismatch signal, never partial data.
      return null
  }
}

// Section-level CONFIG envelope. Nothing is defined for F1 — this seam
// exists so F1b/F2 can extend it without a new export — so ANY non-null
// input parses to null. The caller (the future template-config reader) uses
// a null result on non-null raw as its logError signal.
export function parseTemplateContent(_rendererType: string, _raw: string | null): null {
  return null
}

export function toLegacySectionCopy(copy: TemplateCopyV1): SectionCopyContent {
  return copy.copy
}

export function toLegacyGlobalBody(
  key: GlobalContentKey,
  content: SubsectionContentV1,
): TeamMember[] | ContentBlocks | string | null {
  switch (key) {
    case 'team':
      return 'team' in content ? content.team : null
    case 'process':
      return 'process' in content ? content.process : null
    case 'why':
      return 'why' in content ? content.why : null
    case 'seo-base':
      return 'seoBase' in content ? content.seoBase : null
    case 'geo-base':
      return 'geoBase' in content ? content.geoBase : null
    case 'eeat-base':
      return 'eeatBase' in content ? content.eeatBase : null
    case 'process-milestones':
      return 'processMilestones' in content ? content.processMilestones : null
    case 'pc-intro':
      return 'intro' in content ? content.intro : null
    default:
      return null
  }
}
