// lib/keywords/program-suggest.ts
// KS-3 pure suggestion derivation from a live-scan run's durable rows.
// Signals: program-slug pages (pillar classifier) named by cleaned H1/title,
// plus durable JSON-LD program entities (CrawlRun.programEntitiesJson).
// Suggestions only — the durable roster is human-confirmed. Zero fetches.
// 'heading' evidence is reserved for a future token-mining signal (spec §4).

import { classifyPageType } from '@/lib/services/pillarAnalysis/pageType'
import type { ProgramEntity } from '@/lib/ada-audit/seo/program-entities'
import { MAX_SUGGESTIONS, normalizeProgramName, type ProgramSuggestion } from './program-roster'

export interface SuggestPageInput {
  url: string
  title: string | null
  h1: string | null
  statusCode: number | null
  indexable: boolean | null
  crawlDepth: number | null
}

export function cleanHeading(s: string): string {
  return s.replace(/\s*[|–—]\s*[^|–—]*$/, '').replace(/\s+/g, ' ').trim()
}

export function deriveProgramSuggestions(opts: {
  pages: SuggestPageInput[]
  programEntities: ProgramEntity[]
  confirmedNames: string[]
  dismissedNames: string[]
}): ProgramSuggestion[] {
  const excluded = new Set([...opts.confirmedNames, ...opts.dismissedNames])
  const byName = new Map<string, ProgramSuggestion>()

  const add = (name: string, url: string | undefined, kind: 'slug' | 'schema') => {
    // Cap at the roster's MAX name length so confirmSuggestion can never
    // smuggle an over-long name past validatePrograms (plan-Codex #5).
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 200)
    if (clean.length < 3) return
    const key = normalizeProgramName(clean)
    if (excluded.has(key)) return
    const existing = byName.get(key)
    if (existing) {
      if (!existing.evidence.includes(kind)) existing.evidence.push(kind)
    } else {
      byName.set(key, { name: clean, ...(url ? { url } : {}), evidence: [kind] })
    }
  }

  // Slug signal first — its URL wins on merge (deterministic keep-first).
  // Sort pages by URL so keep-first is order-independent (plan-Codex #5).
  const pages = [...opts.pages].sort((a, b) => a.url.localeCompare(b.url))
  for (const p of pages) {
    const status = p.statusCode ?? 0
    if (status < 200 || status >= 300 || p.indexable === false) continue
    const { pageType } = classifyPageType({ url: p.url, schemaTypes: [], crawlDepth: p.crawlDepth })
    if (pageType !== 'program') continue
    const raw = (p.h1 && cleanHeading(p.h1)) || (p.title && cleanHeading(p.title)) || ''
    if (raw) add(raw, p.url, 'slug')
  }

  for (const e of opts.programEntities) add(e.name, e.url, 'schema')

  return [...byName.values()]
    .sort((a, b) => b.evidence.length - a.evidence.length || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
}
