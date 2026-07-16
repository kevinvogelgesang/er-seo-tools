// Client-safe global-content key constants + body types (the server store in
// global-content.ts imports these; client components import ONLY this file).

export const GLOBAL_CONTENT_KEYS = ['team', 'process', 'why', 'seo-base', 'geo-base', 'eeat-base'] as const
export type GlobalContentKey = (typeof GLOBAL_CONTENT_KEYS)[number]

export interface TeamMember {
  name: string
  role: string
  photo: string | null
  blurb: string
}

export interface ContentBlocks {
  blocks: { heading: string; body: string }[]
}
