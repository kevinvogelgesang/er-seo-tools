// lib/ada-audit/seo/parse-seo-dom.ts
//
// C6 Phase 2: pure rendered-DOM on-page SEO extraction. This function is
// injected into the page via `(${parseSeoFromDocument.toString()})(document, window)`
// (see link-harvest.ts), so it MUST be fully self-contained — NO module-scope
// references (no imports, no module consts/regex). All helpers + constants are
// declared INSIDE the body. Returns RAW fields; the verifier/builder computes
// indexability and derived issues from these. MVP scope: JSON-LD schema only.
export interface RawPageSeo {
  title?: string
  metaDescription?: string
  robotsNoindex: boolean
  canonicalUrl?: string
  h1?: string
  h1Count: number
  h2Count: number
  wordCount: number
  schemaTypes: string[]
  hreflang: string[]
  imageCount: number
  imagesMissingAlt: number
  imagesMissingDimensions: number
  loginLike: boolean
}

export function parseSeoFromDocument(doc: Document, win: Window): RawPageSeo {
  const LOGIN_RE = /\b(sign[\s-]?in|log[\s-]?in|member login)\b/i
  const title = doc.querySelector('title')?.textContent?.trim() || undefined
  const metaDescription =
    doc.querySelector('meta[name="description" i]')?.getAttribute('content')?.trim() || undefined
  const robots = (doc.querySelector('meta[name="robots" i]')?.getAttribute('content') || '').toLowerCase()
  const robotsNoindex = /\bnoindex\b/.test(robots)
  const canonicalUrl = doc.querySelector('link[rel="canonical" i]')?.getAttribute('href') || undefined
  const h1s = Array.from(doc.querySelectorAll('h1'))
  const h1 = h1s[0]?.textContent?.trim() || undefined
  const h1Count = h1s.length
  const h2Count = doc.querySelectorAll('h2').length

  // visible word count — walk ANCESTORS so text inside a hidden container
  // (not just a hidden direct parent) is excluded.
  const hiddenAncestor = (el: Element | null): boolean => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const tag = e.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return true
      if (e.getAttribute && e.getAttribute('aria-hidden') === 'true') return true
      const s = win.getComputedStyle(e as Element)
      if (s && (s.display === 'none' || s.visibility === 'hidden')) return true
    }
    return false
  }
  const walker = doc.createTreeWalker(doc.body || doc.documentElement, (win as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter.SHOW_TEXT)
  let words = 0
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (hiddenAncestor(n.parentElement)) continue
    const t = (n.textContent || '').trim()
    if (t) words += t.split(/\s+/).filter(Boolean).length
  }

  // schema @type set — JSON-LD only, with @graph recursion.
  const schemaTypes: string[] = []
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const collect = (o: unknown): void => {
        if (!o || typeof o !== 'object') return
        if (Array.isArray(o)) { o.forEach(collect); return }
        const rec = o as Record<string, unknown>
        if (rec['@type']) ([] as unknown[]).concat(rec['@type']).forEach((t) => schemaTypes.push(String(t)))
        if (rec['@graph']) collect(rec['@graph'])
      }
      collect(JSON.parse(s.textContent || ''))
    } catch { /* ignore malformed */ }
  }

  const hreflang = Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]'))
    .map((l) => l.getAttribute('hreflang') || '')
    .filter(Boolean)
  // Bound the "bounded JSON" arrays: dedupe + cap at 50 each (Codex fix #7).
  const CAP = 50
  const boundedSchema = Array.from(new Set(schemaTypes)).slice(0, CAP)
  const boundedHreflang = Array.from(new Set(hreflang)).slice(0, CAP)
  const imgs = Array.from(doc.querySelectorAll('img'))
  const imagesMissingAlt = imgs.filter((i) => !i.getAttribute('alt')).length
  const imagesMissingDimensions = imgs.filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).length

  const bodyText = doc.body?.textContent || ''
  const loginLike =
    !!doc.querySelector('input[type="password" i]') ||
    LOGIN_RE.test(title || '') ||
    LOGIN_RE.test(h1 || '') ||
    (LOGIN_RE.test(bodyText) && words < 80) // body match supporting-only (short page)

  return {
    title, metaDescription, robotsNoindex, canonicalUrl, h1, h1Count, h2Count,
    wordCount: words, schemaTypes: boundedSchema, hreflang: boundedHreflang,
    imageCount: imgs.length, imagesMissingAlt, imagesMissingDimensions, loginLike,
  }
}
