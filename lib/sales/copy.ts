// lib/sales/copy.ts
// ALL canned persuasion copy for the sales view lives here so wording is
// editable without touching components. Plain-English, honest labels only —
// no "WCAG compliant", no "Core Web Vitals pass" claims.

export const SECTION_INTROS = {
  accessibility:
    'Accessibility barriers lock out prospective students who rely on assistive technology — and expose the school to ADA demand letters. These are real elements on your site, captured during our scan.',
  seo:
    'Search engines can only recommend what they can read. Broken links, missing titles, and duplicated content all reduce how often your programs appear in front of prospective students.',
  performance:
    'Every extra second of load time costs applicants: slow pages get abandoned before your programs are ever seen. These numbers are Lighthouse-measured on your actual pages.',
  geo:
    'AI search tools (ChatGPT, Gemini, AI Overviews) lean on structured data to understand and recommend schools. Pages without it are effectively invisible to that traffic.',
} as const

export const ISSUE_LABELS: Record<string, string> = {
  broken_internal_links: 'Broken links on your site',
  broken_images: 'Broken images',
  broken_external_links: 'Broken outbound links',
  missing_title: 'Pages missing a title',
  duplicate_title: 'Pages sharing the same title',
  missing_meta_description: 'Pages missing a meta description',
  duplicate_meta_description: 'Duplicated meta descriptions',
  missing_h1: 'Pages missing a main heading',
  duplicate_h1: 'Duplicated main headings',
  thin_content: 'Thin-content pages',
}

export const HIGH_VALUE_SCHEMA_TYPES = ['Organization', 'Course', 'FAQPage', 'BreadcrumbList']

export const CTA_CLOSING =
  'Enrollment Resources helps schools turn findings like these into enrollments. Ask us what we would fix first — and what it would be worth.'

export function issueLabel(type: string): string {
  return ISSUE_LABELS[type] ?? type.replace(/_/g, ' ')
}

/** Human label for the wcagLevel a site audit ran against. */
export function standardLabel(wcagLevel: string): string {
  return wcagLevel === 'wcag22aa' ? 'WCAG 2.2 AA + best practices' : 'WCAG 2.1 AA'
}

// ── C14 redesign additions ───────────────────────────────────────────────
// Honesty rules (extended): compliance claims about the PROSPECT'S site stay
// banned ("WCAG compliant", "Core Web Vitals pass"). The ONE sanctioned
// exception is ER_ADA_CTA below — an ADA-compliance claim about Enrollment
// Resources' OWN product sites (Kevin-approved marketing copy, spec §Non-goals).
// Structured-data copy is evidence-bounded (Codex fix 5): absence = "not
// observed on the pages we scanned", implications describe reduced
// machine-readability — never that markup is *required* for AI quotation.

/** One line per SEO issue group: why this hurts you. Keys = ISSUE_LABELS keys. */
export const ISSUE_WHY: Record<string, string> = {
  broken_internal_links:
    'Dead ends for both students and search crawlers — trust and link equity leak away every time someone hits one.',
  broken_images:
    'Broken images make pages look abandoned to visitors, and the content they carried is invisible to search engines.',
  broken_external_links:
    'Outbound links that hit error pages erode credibility and send prospective students somewhere that no longer exists.',
  missing_title:
    'The page title is the headline Google shows. Pages without one get a generic, unclickable search listing.',
  duplicate_title:
    'Pages sharing one title compete with each other in search — Google struggles to rank any of them for the query they should own.',
  missing_meta_description:
    'Without a description, search engines improvise the snippet under your listing — you lose control of your own pitch.',
  duplicate_meta_description:
    'Repeated descriptions make every search result read the same, cutting click-through on all of them.',
  missing_h1:
    'The main heading tells readers and search engines what a page is about — pages without one read as unstructured.',
  duplicate_h1:
    'Identical main headings blur which page answers which search, so ranking signals get split between them.',
  thin_content:
    'Pages this light rarely rank: there is too little text for search engines to know what the page is for.',
}

/**
 * One line per high-value schema type: what its ABSENCE means. Evidence-
 * bounded — reduced machine-readability, never "required for AI".
 */
export const SCHEMA_IMPLICATIONS: Record<string, string> = {
  Organization:
    'Search and AI tools must infer basics like your name, logo, and contact details instead of reading them directly.',
  Course:
    'Your programs read as plain text to machines — course-rich search features have nothing structured to build from.',
  FAQPage:
    'Search and AI tools have to guess at your answers instead of reading them directly.',
  BreadcrumbList:
    'Search engines have to infer how your site is organized, and results may show raw URLs instead of a clean page trail.',
}

/** Plain-English "How this score is calculated" copy, one per section + overall. */
export const SCORE_METHOD: Record<
  'overall' | 'accessibility' | 'seo' | 'performance' | 'geo',
  { summary: string; note: string }
> = {
  overall: {
    summary:
      'A simple average of the four area scores below — accessibility, SEO, performance, and structured-data coverage. Areas we could not measure are left out of the average rather than counted as zero.',
    note: 'This is our summary yardstick for this scan, not an official rating or certification of any kind.',
  },
  accessibility: {
    summary:
      'Based on an automated axe-core scan of every page we audited, weighted by how severe each barrier is and how dense the barriers are relative to page size. A high score means the automated scan found few barriers.',
    note: 'Automated scanning finds many but not all accessibility issues — a strong score here does not certify legal compliance.',
  },
  seo: {
    summary:
      'Weighted technical factors measured on the pages we scanned: whether pages are indexable, page errors, missing titles, descriptions and headings, thin content, and structured data. If we observed too few pages to be fair, we do not score at all.',
    note: 'Measured from your live pages during this scan — a snapshot, not a rank tracker.',
  },
  performance: {
    summary:
      'The median Google Lighthouse performance score across the pages we measured, plus 75th-percentile timings for paint, layout shift, and blocking time.',
    note: 'Lighthouse-measured lab data from a controlled environment — real-visitor timings can differ.',
  },
  geo: {
    summary:
      'The share of scanned pages carrying any structured data (Schema.org markup), plus whether four high-value types appear at least once anywhere on the site.',
    note: 'Based only on the pages we scanned — coverage may be partial on larger sites.',
  },
}

/** What being tested against WCAG means — accessibility section context line. */
export const WCAG_MEANING =
  'WCAG (the Web Content Accessibility Guidelines) is the standard courts and regulators reference in ADA website cases. Every issue counted here is an automated finding from your live pages — a barrier some visitors will actually hit.'

/** The sanctioned exception: an ADA claim about ER's OWN product sites. */
export const ER_ADA_CTA =
  'Every website Enrollment Resources builds is ADA-compliant as standard — not as an add-on. Barriers like the ones counted above are exactly what we design out from day one. This is fixable, and we do it every day.'
