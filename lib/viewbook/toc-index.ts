// Pure TOC + fuzzy-search index builders (PR7 Task 8). Built server-side from
// data ALREADY on the ViewbookPublicData payload — no new round-trip — and
// consumed by the floating TOC rail (a later task): a serializable TOC index
// plus, in the `building` stage, a client-side fuzzy search index.
//
// Client-safe: no server imports, no Math.random/Date.now.
import type { SectionKey } from './theme'
import type { PublicSection, ViewbookPublicData } from './public-types'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import { CATEGORY_LABELS } from './category-labels'
import { sectionAnchor, categoryAnchor, fieldAnchor, milestoneAnchor, materialAnchor, docAnchor } from './anchors'

export interface TocEntry {
  sectionKey: SectionKey
  label: string
  anchor: string
  done: boolean
  acked: boolean
  children?: { label: string; anchor: string }[]
}

export interface SearchEntry {
  id: string
  kind: 'section' | 'qa' | 'milestone' | 'material' | 'doc'
  label: string
  sectionKey: SectionKey
  anchor: string
  haystack: string
}

// buildTocIndex uses ONLY data.primarySections (already lineup-ordered) — the
// TOC rail navigates the current stage's primary flow, not carried sections.
export function buildTocIndex(data: ViewbookPublicData): TocEntry[] {
  return data.primarySections.map((section: PublicSection): TocEntry => {
    const entry: TocEntry = {
      sectionKey: section.sectionKey,
      label: SECTION_TITLES[section.sectionKey],
      anchor: sectionAnchor(section.sectionKey),
      done: section.state === 'done',
      acked: section.acknowledgedAt != null,
    }
    if (data.stage === 'building' && section.sectionKey === 'data-source') {
      entry.children = data.fieldCategories.map((c) => ({
        label: CATEGORY_LABELS[c.category] ?? c.category,
        anchor: categoryAnchor(c.category),
      }))
    }
    return entry
  })
}

function isVisible(data: ViewbookPublicData, key: SectionKey): boolean {
  return (
    data.primarySections.some((s) => s.sectionKey === key)
    || data.carriedSections.some((s) => s.sectionKey === key)
  )
}

// buildSearchIndex emits entries ONLY for content belonging to a section
// present in data.primarySections/data.carriedSections — never leak content
// from a section that isn't rendered this stage, even if the underlying
// payload arrays still carry rows for it (data-exposure requirement).
export function buildSearchIndex(data: ViewbookPublicData): SearchEntry[] {
  const entries: SearchEntry[] = []

  for (const section of [...data.primarySections, ...data.carriedSections]) {
    entries.push({
      id: `section:${section.sectionKey}`,
      kind: 'section',
      label: SECTION_TITLES[section.sectionKey],
      sectionKey: section.sectionKey,
      anchor: sectionAnchor(section.sectionKey),
      haystack: SECTION_TITLES[section.sectionKey],
    })
  }

  if (isVisible(data, 'data-source')) {
    for (const cat of data.fieldCategories) {
      for (const field of cat.fields) {
        const haystack = field.value ? `${field.label} ${field.value}` : field.label
        entries.push({
          id: `qa:${field.id}`,
          kind: 'qa',
          label: field.label,
          sectionKey: 'data-source',
          anchor: fieldAnchor(field.id),
          haystack,
        })
      }
    }
  }

  if (isVisible(data, 'milestones')) {
    for (const m of data.milestones) {
      entries.push({
        id: `milestone:${m.id}`,
        kind: 'milestone',
        label: m.title,
        sectionKey: 'milestones',
        anchor: milestoneAnchor(m.id),
        haystack: m.blurb ? `${m.title} ${m.blurb}` : m.title,
      })
    }
  }

  if (isVisible(data, 'materials')) {
    for (const m of data.materials) {
      entries.push({
        id: `material:${m.id}`,
        kind: 'material',
        label: m.label,
        sectionKey: 'materials',
        anchor: materialAnchor(m.id),
        haystack: m.label,
      })
    }
  }

  if (isVisible(data, 'strategy')) {
    for (const d of [...data.docs.global, ...data.docs.own]) {
      entries.push({
        id: `doc:${d.id}`,
        kind: 'doc',
        label: d.title,
        sectionKey: 'strategy',
        anchor: docAnchor(d.filename),
        haystack: d.blurb ? `${d.title} ${d.blurb}` : d.title,
      })
    }
  }

  return entries
}

// Dependency-free case-insensitive subsequence match: every query character
// must appear in the haystack IN ORDER or the score is 0 ("no match"). Among
// matches, contiguous runs and word-start hits score higher so a fuller
// substring match outranks a scattered subsequence match.
export function fuzzyScore(query: string, haystack: string): number {
  const q = query.toLowerCase()
  const h = haystack.toLowerCase()
  if (q.length === 0) return 0

  let score = 0
  let qi = 0
  let lastMatchIndex = -1
  let consecutiveRun = 0

  for (let hi = 0; hi < h.length && qi < q.length; hi++) {
    if (h[hi] !== q[qi]) continue

    let charScore = 1
    if (lastMatchIndex === hi - 1) {
      consecutiveRun++
      charScore += consecutiveRun * 2
    } else {
      consecutiveRun = 0
    }

    const isWordStart = hi === 0 || !/[a-z0-9]/.test(h[hi - 1])
    if (isWordStart) charScore += 3

    score += charScore
    lastMatchIndex = hi
    qi++
  }

  if (qi < q.length) return 0
  return score
}

export function searchViewbook(index: SearchEntry[], query: string, limit?: number): SearchEntry[] {
  const cap = limit ?? 20
  return index
    .map((entry) => ({ entry, score: fuzzyScore(query, entry.haystack) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((x) => x.entry)
}
