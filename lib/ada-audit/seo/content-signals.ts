// lib/ada-audit/seo/content-signals.ts
//
// C12 Increment B: pure per-page content-signal computation (stale-date
// references + readability scoring) over already-harvested page text. This is
// an ORDINARY Node module — it is never `.toString()`-injected into a browser
// page, so no SWC/typeof/module-scope restrictions apply. Fully pure: no
// Date, no I/O, no randomness. `currentYear` is injected by the caller so the
// module stays deterministic and testable.

export type ContentSignalsInput = {
  url: string
  contentText: string | null
  contentTruncated: boolean
}

export type StaleDateHit = { kind: 'copyright' | 'term' | 'deadline'; year: number; excerpt: string }

export type ContentSignalsResult = {
  observedPages: number
  truncatedPages: number
  staleDates: {
    pagesWithHits: number
    pages: Array<{ url: string; hits: StaleDateHit[] }>
  }
  readability: {
    scoredPages: number
    medianFleschReadingEase: number | null
    medianGradeLevel: number | null
    pages: Array<{ url: string; fleschReadingEase: number; gradeLevel: number; words: number }>
  }
}

export const READABILITY_MIN_WORDS = 100
const STALE_HITS_PER_PAGE_CAP = 5
const LIST_PAGE_CAP = 50
const EXCERPT_RADIUS = 60 // ~120 chars total window around the match

const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)*/g

function tokenizeWords(text: string): string[] {
  return text.match(WORD_RE) ?? []
}

function countSentences(text: string): number {
  const n = (text.match(/[.!?]+/g) ?? []).length
  return n === 0 ? 1 : n
}

function countSyllables(word: string): number {
  const w = word.toLowerCase()
  const groups = (w.match(/[aeiouy]+/g) ?? []).length
  let syl = Math.max(1, groups)
  if (w.endsWith('e') && !w.endsWith('le') && syl > 1) syl -= 1
  return syl
}

function round1(x: number): number {
  return Math.round(x * 10) / 10
}

function readabilityForPage(url: string, text: string): { url: string; fleschReadingEase: number; gradeLevel: number; words: number } | null {
  const words = tokenizeWords(text)
  const wordCount = words.length
  if (wordCount < READABILITY_MIN_WORDS) return null
  const sentences = countSentences(text)
  let syllables = 0
  for (const w of words) syllables += countSyllables(w)
  const fre = 206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllables / wordCount)
  const fk = 0.39 * (wordCount / sentences) + 11.8 * (syllables / wordCount) - 15.59
  return { url, fleschReadingEase: round1(fre), gradeLevel: round1(fk), words: wordCount }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const mid = Math.floor(n / 2)
  if (n % 2 === 1) return sorted[mid]
  return round1((sorted[mid - 1] + sorted[mid]) / 2)
}

function makeExcerpt(line: string, matchStart: number, matchEnd: number): string {
  const start = Math.max(0, matchStart - EXCERPT_RADIUS)
  const end = Math.min(line.length, matchEnd + EXCERPT_RADIUS)
  let excerpt = line.slice(start, end).trim()
  if (start > 0) excerpt = '…' + excerpt
  if (end < line.length) excerpt = excerpt + '…'
  return excerpt
}

// © / (c) / Copyright token, then a year OR a year range (hyphen / en-dash / em-dash / "to").
const COPYRIGHT_RE = /(?:©|\(c\)|Copyright)\s*(\d{4})(?:\s*(?:[-–—]|to)\s*(\d{4}))?/gi
const TERM_RE = /\b(Fall|Spring|Summer|Winter|Autumn)\b\s*(\d{4})/gi
const DEADLINE_KEYWORD_RE = /\b(apply|enroll(?:ment)?|deadline|registration|starts?|start date|class of)\b/gi
const YEAR_RE = /\b(\d{4})\b/g
// Capturing group so String.split keeps the terminator runs interleaved with
// sentence bodies — lets the deadline pass advance its offset by the ACTUAL
// matched terminator length instead of assuming 1 char.
const SENTENCE_SPLIT_RE = /([.!?]+)/

// A candidate stale-date hit carries its start index WITHIN the line so all
// three rule passes can be interleaved by textual position before capping —
// the pinned contract requires the per-page cap to keep hits in document
// order, not by rule-class priority.
type LineCandidate = StaleDateHit & { start: number }

function staleDatesForLine(line: string, currentYear: number): LineCandidate[] {
  const candidates: LineCandidate[] = []

  // copyright — fresh RegExp per line avoids stateful-lastIndex bugs across lines.
  const copyrightRe = new RegExp(COPYRIGHT_RE.source, COPYRIGHT_RE.flags)
  let m: RegExpExecArray | null
  while ((m = copyrightRe.exec(line))) {
    const first = parseInt(m[1], 10)
    const second = m[2] ? parseInt(m[2], 10) : null
    const latest = second !== null ? Math.max(first, second) : first
    if (latest <= currentYear - 2) {
      candidates.push({ kind: 'copyright', year: latest, excerpt: makeExcerpt(line, m.index, m.index + m[0].length), start: m.index })
    }
  }

  // term — season word + year in the same match window
  const termRe = new RegExp(TERM_RE.source, TERM_RE.flags)
  while ((m = termRe.exec(line))) {
    const year = parseInt(m[2], 10)
    if (year < currentYear) {
      candidates.push({ kind: 'term', year, excerpt: makeExcerpt(line, m.index, m.index + m[0].length), start: m.index })
    }
  }

  // deadline — enrollment keyword + year within the same SENTENCE (not just line).
  // Split with a capturing group so we advance the offset by the ACTUAL matched
  // terminator length (multi-char terminators like "?!" / "..." must not shift
  // the reconstructed line offset used for the excerpt).
  const parts = line.split(SENTENCE_SPLIT_RE)
  let offset = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i % 2 === 1) {
      // captured terminator run — not a sentence body, just advance the offset
      offset += part.length
      continue
    }
    const sentence = part
    const sentenceStart = offset
    offset += sentence.length
    const keywordRe = new RegExp(DEADLINE_KEYWORD_RE.source, DEADLINE_KEYWORD_RE.flags)
    if (!keywordRe.test(sentence)) continue
    const yearRe = new RegExp(YEAR_RE.source, YEAR_RE.flags)
    let ym: RegExpExecArray | null
    while ((ym = yearRe.exec(sentence))) {
      const year = parseInt(ym[1], 10)
      if (year < currentYear) {
        const absStart = sentenceStart + ym.index
        candidates.push({
          kind: 'deadline',
          year,
          excerpt: makeExcerpt(line, absStart, absStart + ym[0].length),
          start: absStart,
        })
      }
    }
  }

  // Interleave all three rule passes by textual position (stable for ties).
  candidates.sort((a, b) => a.start - b.start)
  return candidates
}

function staleDatesForPage(text: string, currentYear: number): StaleDateHit[] {
  const hits: StaleDateHit[] = []
  const lines = text.split('\n')
  // Cross-line order is preserved by the outer loop; within-line order is
  // preserved by the position sort in staleDatesForLine. The per-page cap of 5
  // then keeps the first 5 hits in document order.
  for (const line of lines) {
    if (hits.length >= STALE_HITS_PER_PAGE_CAP) break
    for (const c of staleDatesForLine(line, currentYear)) {
      if (hits.length >= STALE_HITS_PER_PAGE_CAP) break
      hits.push({ kind: c.kind, year: c.year, excerpt: c.excerpt })
    }
  }
  return hits
}

export function computeContentSignals(
  pages: ContentSignalsInput[],
  opts: { currentYear: number },
): ContentSignalsResult | null {
  const { currentYear } = opts
  const observed = pages.filter(p => p.contentText != null)
  if (observed.length === 0) return null

  const truncatedPages = observed.filter(p => p.contentTruncated).length

  const staleDatePages: Array<{ url: string; hits: StaleDateHit[] }> = []
  const readabilityPages: Array<{ url: string; fleschReadingEase: number; gradeLevel: number; words: number }> = []

  for (const p of observed) {
    const text = p.contentText as string
    const hits = staleDatesForPage(text, currentYear)
    if (hits.length > 0) staleDatePages.push({ url: p.url, hits })

    const scored = readabilityForPage(p.url, text)
    if (scored) readabilityPages.push(scored)
  }

  const sortedStale = [...staleDatePages].sort((a, b) => {
    if (b.hits.length !== a.hits.length) return b.hits.length - a.hits.length
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0
  })
  const sortedReadability = [...readabilityPages].sort((a, b) => {
    if (a.fleschReadingEase !== b.fleschReadingEase) return a.fleschReadingEase - b.fleschReadingEase
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0
  })

  return {
    observedPages: observed.length,
    truncatedPages,
    staleDates: {
      pagesWithHits: staleDatePages.length,
      pages: sortedStale.slice(0, LIST_PAGE_CAP),
    },
    readability: {
      scoredPages: readabilityPages.length,
      medianFleschReadingEase: median(readabilityPages.map(p => p.fleschReadingEase)),
      medianGradeLevel: median(readabilityPages.map(p => p.gradeLevel)),
      pages: sortedReadability.slice(0, LIST_PAGE_CAP),
    },
  }
}
