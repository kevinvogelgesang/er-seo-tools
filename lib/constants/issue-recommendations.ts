export const ISSUE_RECOMMENDATIONS: Record<string, string> = {
  // Critical
  broken_pages: 'CRITICAL: Fix or redirect {count} broken pages (4xx/5xx errors) to prevent user frustration and crawl budget waste.',
  missing_title: 'CRITICAL: Add title tags to {count} pages. Title tags are essential for SEO and click-through rates.',
  broken_internal_links: 'CRITICAL: Fix {count} broken internal links to improve user experience and internal link equity.',
  server_errors_5xx: 'CRITICAL: Investigate {count} server errors (5xx) that indicate backend issues.',
  client_errors_4xx: 'CRITICAL: Fix {count} pages returning 4xx client errors (not found, forbidden, etc.).',
  long_redirect_chains: 'CRITICAL: Fix {count} long redirect chains (4+ hops) causing significant latency.',
  broken_hreflang_targets: 'CRITICAL: Fix {count} hreflang URLs returning errors, breaking international targeting.',

  // Warnings
  missing_meta_description: 'Add meta descriptions to {count} pages to improve search result appearance and CTR.',
  missing_h1: 'Add H1 headings to {count} pages to improve content structure and accessibility.',
  duplicate_title: 'Create unique title tags for {count} duplicate title groups.',
  duplicate_titles: 'Create unique title tags for {count} duplicate title groups.',
  duplicate_meta_description: 'Create unique meta descriptions for {count} duplicate groups.',
  duplicate_h1: 'Create unique H1 headings for {count} pages sharing the same H1.',
  multiple_titles: 'Fix {count} pages with multiple title tags - each page should have exactly one.',
  multiple_h1: 'Fix {count} pages with multiple H1 headings - best practice is one H1 per page.',
  thin_content: 'Expand content on {count} thin pages (< 300 words) to provide more value.',
  redirect_chains: 'Simplify {count} redirect chains to reduce latency and preserve link equity.',
  missing_hreflang_return: 'Fix {count} hreflang entries missing return links for proper international targeting.',

  // Warnings - Resources
  broken_images: 'CRITICAL: Fix {count} broken images that are returning 4xx/5xx errors.',
  very_large_images: 'CRITICAL: Optimize {count} very large images (> 500KB) severely impacting page load.',
  large_images: 'Optimize {count} large images (> 100KB) to improve page load times.',
  missing_alt_text: 'Add alt text to {count} images for better accessibility and image SEO.',
  broken_js: 'CRITICAL: Fix {count} broken JavaScript files that may break site functionality.',
  large_js_files: 'Consider code splitting or lazy loading for {count} large JavaScript files (> 100KB).',
  broken_css: 'Fix {count} broken CSS files that may cause styling issues.',
  large_css_files: 'Consider optimizing {count} CSS files over 100KB.',
  broken_pdfs: 'Fix {count} broken PDF links.',
  large_pdfs: 'Consider compressing {count} PDFs over 5MB for faster downloads.',
  broken_external_links: 'Fix or remove {count} broken external links.',
  empty_anchor_text: 'Add descriptive anchor text to {count} links with empty anchors.',
  insecure_pages: 'CRITICAL: Migrate {count} pages from HTTP to HTTPS for security and SEO.',
  mixed_content: 'Fix {count} HTTPS pages loading insecure HTTP resources.',
  sitemap_errors: 'Fix {count} URLs in sitemap that are returning errors.',
  sitemap_redirects: 'Update sitemap to include {count} final URLs instead of redirecting URLs.',
  non_indexable_in_sitemap: 'Remove {count} non-indexable URLs from sitemap.',
  orphan_pages: 'Add internal links to {count} orphan pages not linked from anywhere on the site.',

  // Notices
  title_too_long: 'Consider shortening {count} title tags that exceed 60 characters.',
  title_too_short: 'Expand {count} title tags under 30 characters to be more descriptive.',
  meta_description_too_short: 'Expand {count} meta descriptions under 70 characters.',
  meta_description_too_long: 'Consider shortening {count} meta descriptions over 160 characters.',
  missing_h2: 'Consider adding H2 subheadings to {count} pages for better content structure.',
  noindex_pages: 'Review {count} pages with noindex directive to ensure they should be excluded.',
  temporary_redirects: 'Consider converting {count} temporary (302) redirects to permanent (301).',
  missing_canonical: 'Add canonical tags to {count} pages to prevent duplicate content issues.',
  non_self_canonical: 'Review {count} pages with canonical pointing to different URL.',

  // Performance / Core Web Vitals
  poor_lcp: 'Improve Largest Contentful Paint (LCP) on {count} pages exceeding 4 seconds.',
  poor_cls: 'Fix Cumulative Layout Shift (CLS) issues on {count} pages with scores > 0.25.',
  poor_fid: 'Improve First Input Delay/INP on {count} pages exceeding 300ms.',
  poor_performance_score: 'CRITICAL: Investigate {count} pages with poor performance scores (< 50).',
  slow_server_response: 'Investigate slow server response times (> 600ms) on {count} pages.',

  // Analytics / Search Console
  pages_no_traffic: 'Review {count} pages with zero sessions in analytics - consider improving content or internal linking.',
  high_bounce_rate: 'Investigate {count} pages with bounce rate over 80% - may indicate content or UX issues.',
  low_ctr_opportunities: 'Improve titles/meta descriptions for {count} pages with high impressions but low CTR.',

  // Structured Data
  schema_validation_errors: 'Fix structured data validation errors on {count} pages.',
  schema_validation_warnings: 'Review structured data warnings on {count} pages.',
  rich_result_errors: 'Fix rich result validation errors on {count} pages to enable rich snippets.',

  // Anchor Text (additional)
  non_descriptive_anchor_text: 'Replace {count} non-descriptive anchor texts (e.g., "click here", "read more") with keyword-rich, descriptive anchors.',
  single_anchor_variation: 'Diversify anchor text for {count} pages that only receive links with a single anchor text variation.',

  // NEW — Accessibility
  accessibility_errors: 'CRITICAL: Fix WCAG accessibility errors on {count} pages to meet legal compliance and improve usability for all users.',
  accessibility_alerts: 'Review WCAG accessibility warnings on {count} pages to improve usability and compliance.',

  // NEW — Images
  images_missing_dimensions: 'Add width/height attributes to {count} images to prevent Cumulative Layout Shift (CLS) and improve Core Web Vitals.',

  // NEW — Duplicate Content
  exact_duplicate_pages: 'Consolidate or canonicalize {count} exact duplicate pages to prevent crawl budget waste and duplicate content penalties.',
  near_duplicate_pages: 'Review {count} near-duplicate pages and either merge, canonicalize, or differentiate their content.',
  duplicate_title_tags: 'Create unique title tags for {count} groups of pages sharing the same title tag.',
  duplicate_meta_descriptions: 'Create unique meta descriptions for {count} groups of pages sharing the same meta description.',
  duplicate_h1_tags: 'Ensure unique H1 headings for {count} groups of pages sharing the same H1.',

  // NEW — Keyword Signals
  keyword_cannibalization: 'Resolve keyword cannibalization for {count} keywords competing across multiple URLs — consolidate or differentiate content.',
};

/** Fill the {count} placeholder in a recommendation template. */
export function fillRecommendationTemplate(template: string, count: number): string {
  return template.replace(/\{count\}/g, String(count));
}
