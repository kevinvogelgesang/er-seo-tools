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
  programNames: string[] // KS-3: JSON-LD Course/EducationalOccupationalProgram names, ≤20, each ≤120 chars
  hreflang: { lang: string; href: string }[]
  imageCount: number
  imagesMissingAlt: number
  imagesMissingDimensions: number
  loginLike: boolean
  contentText?: string
  contentTruncated: boolean
  // KS-4: raw FAQ signals (tri-state evidence is derived Node-side in
  // lib/ada-audit/seo/faq-evidence.ts — detection proves presence, never absence)
  faqSignals: { heading: boolean; container: boolean; questionHeadings: number }
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
  // C6 Phase 5: also accumulate bounded main-content text (excludes nav/header/
  // footer/aside so cross-page boilerplate doesn't inflate similarity). Layer-1
  // boilerplate strip; the builder does layer-2 (cross-page DF filtering).
  const inBoilerplateRegion = (el: Element | null): boolean => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const tag = e.tagName
      if (tag === 'NAV' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'ASIDE') return true
      const role = e.getAttribute && e.getAttribute('role')
      if (role === 'navigation' || role === 'banner' || role === 'contentinfo') return true
    }
    return false
  }
  const CONTENT_CAP = 30000
  let content = ''
  let contentTruncated = false
  const walker = doc.createTreeWalker(doc.body || doc.documentElement, (win as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter.SHOW_TEXT)
  let words = 0
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (hiddenAncestor(n.parentElement)) continue
    const t = (n.textContent || '').trim()
    if (!t) continue
    words += t.split(/\s+/).filter(Boolean).length
    // do NOT break/continue on cap — keep walking so wordCount stays whole
    if (!contentTruncated && !inBoilerplateRegion(n.parentElement)) {
      const piece = content ? ' ' + t : t
      if (content.length + piece.length > CONTENT_CAP) {
        content += piece.slice(0, CONTENT_CAP - content.length)
        contentTruncated = true
      } else {
        content += piece
      }
    }
  }

  // schema @type set — JSON-LD only, with @graph recursion.
  // KS-3: also collect Course/EducationalOccupationalProgram names.
  const schemaTypes: string[] = []
  const programNames: string[] = []
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const collect = (o: unknown): void => {
        if (!o) return
        if (Array.isArray(o)) { o.forEach(collect); return }
        const rec = o as Record<string, unknown>
        if (rec['@type']) {
          const types = ([] as unknown[]).concat(rec['@type'])
          types.forEach((t) => schemaTypes.push(String(t)))
          // String-primitive check without typeof (injected-code contract):
          // String(v) === v is true only for string primitives.
          // Dedupe at insert so the 20-cap counts UNIQUE names (plan-Codex #1).
          const nameVal = rec['name']
          if (
            nameVal != null && String(nameVal) === nameVal && programNames.length < 20 &&
            types.some((t) => String(t) === 'Course' || String(t) === 'EducationalOccupationalProgram')
          ) {
            const nm = (nameVal as string).slice(0, 120)
            if (programNames.indexOf(nm) === -1) programNames.push(nm)
          }
        }
        if (rec['@graph']) collect(rec['@graph'])
      }
      collect(JSON.parse(s.textContent || ''))
    } catch { /* ignore malformed */ }
  }

  // hreflang alternates as {lang, href} pairs — dedupe by lang keep-first, cap 50.
  const hreflang: { lang: string; href: string }[] = []
  const seenLang: Record<string, number> = {}
  for (const l of Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]'))) {
    const lang = l.getAttribute('hreflang') || ''
    if (!lang || seenLang[lang]) continue
    seenLang[lang] = 1
    hreflang.push({ lang: lang, href: l.getAttribute('href') || '' })
    if (hreflang.length >= 50) break
  }
  // Bound the "bounded JSON" arrays: dedupe + cap at 50 each (Codex fix #7).
  const CAP = 50
  const boundedSchema = Array.from(new Set(schemaTypes)).slice(0, CAP)
  const imgs = Array.from(doc.querySelectorAll('img'))
  const imagesMissingAlt = imgs.filter((i) => !i.getAttribute('alt')).length
  const imagesMissingDimensions = imgs.filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).length

  const bodyText = doc.body?.textContent || ''
  const loginLike =
    !!doc.querySelector('input[type="password" i]') ||
    LOGIN_RE.test(title || '') ||
    LOGIN_RE.test(h1 || '') ||
    (LOGIN_RE.test(bodyText) && words < 80) // body match supporting-only (short page)

  // KS-4: bounded FAQ signals. Heading pass: inspect up to 300 ELIGIBLE
  // (non-boilerplate, non-hidden) h2/h3/h4, walking at most 600 raw — an
  // eligible-only cap would let a heading-heavy mega-nav starve the content
  // headings this signal depends on (spec Codex #3).
  const FAQ_HEADING_RE = /\bfaqs?\b|frequently asked/i
  let faqHeading = false
  let questionHeadings = 0
  const faqHs = Array.from(doc.querySelectorAll('h2,h3,h4'))
  let faqEligible = 0
  for (let i = 0; i < faqHs.length && i < 600 && faqEligible < 300; i++) {
    const el = faqHs[i]
    if (hiddenAncestor(el) || inBoilerplateRegion(el)) continue
    faqEligible++
    const t = (el.textContent || '').trim()
    if (FAQ_HEADING_RE.test(t)) faqHeading = true
    if (t.endsWith('?')) questionHeadings++
  }
  // Container pass: first 50 faq-ish id/class elements; counts when outside
  // boilerplate/hidden AND (is itself a <details> — querySelector never
  // matches the element itself — or contains a heading/<details> descendant).
  let faqContainer = false
  for (const el of Array.from(doc.querySelectorAll('[id*="faq" i],[class*="faq" i]')).slice(0, 50)) {
    if (hiddenAncestor(el) || inBoilerplateRegion(el)) continue
    if (el.tagName === 'DETAILS' || el.querySelector('h2,h3,h4,h5,h6,details')) { faqContainer = true; break }
  }

  return {
    title, metaDescription, robotsNoindex, canonicalUrl, h1, h1Count, h2Count,
    wordCount: words, schemaTypes: boundedSchema, programNames, hreflang,
    imageCount: imgs.length, imagesMissingAlt, imagesMissingDimensions, loginLike,
    contentText: content || undefined, contentTruncated,
    faqSignals: { heading: faqHeading, container: faqContainer, questionHeadings },
  }
}
