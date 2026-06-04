import type { Issue, IssuesResult } from '@/lib/types';

/**
 * IssuesOverviewParser emits a count-only `sf_<name>` issue for EVERY Screaming
 * Frog issue. Dedicated parsers emit richer, URL-bearing curated issues for the
 * important categories. That double-counts: e.g. `sf_images_over_100_kb` (9, no
 * URLs) alongside `large_images` (9, with URLs) → duplicate Teamwork tasks and
 * an inflated no-URL ratio.
 *
 * This table maps an `sf_` type to the curated type(s) that supersede it. When a
 * superseding curated issue is actually present, the `sf_` duplicate is dropped
 * (the curated one is strictly richer). `sf_` issues with NO curated equivalent
 * (security headers, URL underscores, high-external-outlinks, …) are the genuine
 * value-add of the overview and are always kept. Conservative by design: only
 * high-confidence equivalences are listed — an unmapped overlap merely leaves a
 * (rare) duplicate, whereas a wrong mapping would DROP a real finding.
 */
export const SF_SUPERSEDED_BY: Record<string, string[]> = {
  // Images
  sf_images_over_100_kb: ['large_images', 'very_large_images'],
  sf_images_missing_alt_text: ['missing_alt_text'],
  sf_images_missing_alt_attribute: ['missing_alt_text'],
  sf_images_missing_size_attributes: ['images_missing_dimensions'],
  // Response codes
  sf_response_codes_internal_client_error_4xx: ['client_errors_4xx'],
  sf_response_codes_internal_server_error_5xx: ['server_errors_5xx'],
  // Directives
  sf_directives_noindex: ['noindex_pages'],
  sf_directives_nofollow: ['nofollow_pages'],
  // Links / anchors
  sf_links_internal_outlinks_with_no_anchor_text: ['empty_anchor_text'],
  // Headings (H2). Keep sf_h2_multiple — no curated twin.
  sf_h2_missing: ['missing_h2'],
};

/**
 * Returns true if `issue` is an `sf_` passthrough whose curated equivalent is
 * present in `presentCuratedTypes` (and should therefore be dropped).
 */
function isSuperseded(issue: Issue, presentCuratedTypes: Set<string>): boolean {
  if (!issue.type.startsWith('sf_')) return false;
  const supersedes = SF_SUPERSEDED_BY[issue.type];
  return !!supersedes && supersedes.some((t) => presentCuratedTypes.has(t));
}

/**
 * Drop `sf_` passthrough issues that are superseded by a present curated issue.
 * The present-set is computed across ALL severities, so a curated issue in one
 * bucket suppresses its `sf_` duplicate in another.
 */
export function dropSupersededSfIssues(issues: IssuesResult): IssuesResult {
  const all = [...issues.critical, ...issues.warnings, ...issues.notices];
  const presentCurated = new Set(all.filter((i) => !i.type.startsWith('sf_')).map((i) => i.type));
  const keep = (list: Issue[]) => list.filter((i) => !isSuperseded(i, presentCurated));
  return {
    critical: keep(issues.critical),
    warnings: keep(issues.warnings),
    notices: keep(issues.notices),
  };
}
