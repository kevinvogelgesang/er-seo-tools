// Code-owned, client-safe renderer-type registry (F1a task 4, fix #11).
// The ONE home of the fixed set of section renderer types a template's
// SectionTemplate.rendererType may reference. Includes every existing
// SectionKey (rendererType == sectionKey today — identity-preserving) plus
// 'generic', reserved for the config-driven renderer shipping in F3/F5b.
import type { SectionKey } from './theme'

export const RENDERER_TYPE_IDS = [
  'welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy',
  'materials', 'pc-intro', 'pc-setup', 'pc-invite', 'pc-thanks',
  'kickoff-next', 'ws-intro', 'generic',
] as const

export type RendererTypeId = (typeof RENDERER_TYPE_IDS)[number]

export interface RendererTypeMeta {
  id: RendererTypeId
  // Optional primary action, moved verbatim from SECTION_COPY[key].cta
  cta: { label: string; sectionKey: SectionKey; anchor: string } | null
}

function meta(id: RendererTypeId, cta: RendererTypeMeta['cta'] = null): RendererTypeMeta {
  return { id, cta }
}

export const RENDERER_TYPES: Record<RendererTypeId, RendererTypeMeta> = {
  'welcome': meta('welcome'),
  'milestones': meta('milestones'),
  'data-source': meta('data-source'),
  'brand': meta('brand'),
  'assessment': meta('assessment'),
  'strategy': meta('strategy'),
  'materials': meta('materials'),
  'pc-intro': meta('pc-intro'),
  'pc-setup': meta('pc-setup', { label: 'Fill in org basics', sectionKey: 'pc-setup', anchor: '#pc-setup' }),
  'pc-invite': meta('pc-invite'),
  'pc-thanks': meta('pc-thanks'),
  'kickoff-next': meta('kickoff-next'),
  'ws-intro': meta('ws-intro'),
  'generic': meta('generic'),
}

export function isRendererTypeId(v: string): v is RendererTypeId {
  return (RENDERER_TYPE_IDS as readonly string[]).includes(v)
}
