// lib/parsers/expected-exports.ts
//
// Single source of truth for "what a complete Screaming Frog crawl looks like"
// for the technical-SEO workflow. PURE module (no parser classes, no papaparse)
// so it is safe to import from client components. This describes expected-file
// COVERAGE only — it is NOT a parser resolver. findParserForFile() remains the
// authoritative parser selector on the server.

export type ExportTier = 'core' | 'recommended' | 'optional';

export interface ExpectedExport {
  /** stable key */
  id: string;
  /** human label for the checklist */
  label: string;
  /** case-insensitive filename substrings; any match = present */
  filenamePatterns: string[];
  tier: ExportTier;
  /** "enable this in Screaming Frog" guidance shown when missing */
  sfInstructions: string;
  /** true for non-SF (SEMRush) inputs — never flagged as an SF crawl gap */
  notExpectedFromSf?: boolean;
}

export const EXPECTED_EXPORTS: ExpectedExport[] = [
  {
    id: 'internal_all',
    label: 'Internal — All',
    filenamePatterns: ['internal_all'],
    tier: 'core',
    sfInstructions: 'Bulk Export → Internal → All. The core crawl (titles, H1s, meta, status, depth, indexability).',
  },
  {
    id: 'response_codes',
    label: 'Response Codes',
    filenamePatterns: ['response_codes'],
    tier: 'core',
    sfInstructions: 'Bulk Export → Response Codes (prefer the Internal export so 4xx counts exclude external link targets).',
  },
  {
    id: 'page_titles',
    label: 'Page Titles',
    filenamePatterns: ['page_titles'],
    tier: 'recommended',
    sfInstructions: 'Bulk Export → Page Titles → All. Powers duplicate/missing/short title detection with per-URL groups.',
  },
  {
    id: 'meta_description',
    label: 'Meta Descriptions',
    filenamePatterns: ['meta_description'],
    tier: 'recommended',
    sfInstructions: 'Bulk Export → Meta Description → All.',
  },
  {
    id: 'h1',
    label: 'H1',
    filenamePatterns: ['h1_'],
    tier: 'recommended',
    sfInstructions: 'Bulk Export → H1 → All.',
  },
  {
    id: 'images_missing_alt_text',
    label: 'Images Missing Alt Text',
    filenamePatterns: ['images_missing_alt_text'],
    tier: 'recommended',
    sfInstructions: 'Bulk Export → Images → Missing Alt Text. Per-image accessibility & image-SEO list.',
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    filenamePatterns: ['accessibility'],
    tier: 'optional',
    sfInstructions: 'Config → Spider → Rendering = JavaScript, enable Accessibility; then Bulk Export → Accessibility.',
  },
  {
    id: 'exact_duplicates',
    label: 'Exact Duplicates',
    filenamePatterns: ['exact_duplicates'],
    tier: 'optional',
    sfInstructions: 'Config → Content → Duplicates; then Reports → Duplicates → Exact.',
  },
  {
    id: 'low_content',
    label: 'Low Content Pages',
    filenamePatterns: ['low_content'],
    tier: 'optional',
    sfInstructions: 'Enable content analysis; then Bulk Export → Content → Low Content Pages.',
  },
  {
    id: 'redirect_chains',
    label: 'Redirect Chains',
    filenamePatterns: ['redirect_chains'],
    tier: 'optional',
    sfInstructions: 'Reports → Redirects → Redirect Chains.',
  },
  {
    id: 'all_redirects',
    label: 'All Redirects',
    // NOTE: reconcile against the real SF export filename in Task 8.
    filenamePatterns: ['all_redirects', 'redirects'],
    tier: 'optional',
    sfInstructions: 'Reports → Redirects → All Redirects.',
  },
  {
    id: 'pagespeed',
    label: 'PageSpeed (CWV)',
    filenamePatterns: ['pagespeed'],
    tier: 'optional',
    sfInstructions: 'Configure the PageSpeed Insights API in SF; then Bulk Export → PageSpeed. Adds Core Web Vitals.',
  },
  {
    id: 'search_console',
    label: 'Search Console',
    filenamePatterns: ['search_console'],
    tier: 'optional',
    sfInstructions: 'Connect Search Console in SF; then Bulk Export → Search Console. Adds clicks/impressions/position.',
  },
  {
    id: 'semrush_organic_positions',
    label: 'SEMRush Organic Positions',
    filenamePatterns: ['organic.positions', 'organic_positions'],
    tier: 'optional',
    sfInstructions: 'Not a Screaming Frog export — SEMRush → Organic Research → Positions.',
    notExpectedFromSf: true,
  },
];

export interface ExportCoverage {
  export: ExpectedExport;
  present: boolean;
  matchedFile?: string;
}

/**
 * Case-insensitive substring match of uploaded filenames against the manifest,
 * mirroring findParserForFile's filename pass — but without importing parser
 * classes (client-safe).
 */
export function matchExpectedExports(filenames: string[]): ExportCoverage[] {
  const lower = filenames.map((f) => ({ orig: f, lc: f.toLowerCase() }));
  return EXPECTED_EXPORTS.map((exp) => {
    const hit = lower.find(({ lc }) =>
      exp.filenamePatterns.some((p) => lc.includes(p.toLowerCase()))
    );
    return { export: exp, present: !!hit, matchedFile: hit?.orig };
  });
}

/** Core exports (tier 'core') that are NOT covered by the uploaded files. */
export function missingCoreExports(filenames: string[]): ExpectedExport[] {
  return matchExpectedExports(filenames)
    .filter((c) => c.export.tier === 'core' && !c.present)
    .map((c) => c.export);
}
