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
