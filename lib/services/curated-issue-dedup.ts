import type { Issue, IssuesResult } from '@/lib/types';

/**
 * Curated issue types that describe the SAME finding under different names,
 * listed in PREFERENCE order (most precise / URL-bearing first). The first
 * present type in a group is kept; the rest are dropped.
 *
 * This complements `dropSupersededSfIssues` (which collapses count-only `sf_*`
 * passthroughs into a curated equivalent). Here we collapse curated↔curated
 * overlap where the TYPES differ.
 *
 * Today the only live overlap is duplicate-titles: PageTitlesParser emits
 * `duplicate_title` (grouped, URL-bearing); the internal_all summary emits
 * `duplicate_titles` (groups, no per-URL list) as a fallback when the
 * page_titles export is absent. Prefer `duplicate_title`; keep `duplicate_titles`
 * only when it is the sole signal. (The former `duplicate_title_tags`,
 * `duplicate_meta_descriptions`, and `duplicate_h1_tags` wrapper emissions were
 * deleted at source — they had no consumer beyond the issue list.)
 */
export const CURATED_CANONICAL: string[][] = [
  ['duplicate_title', 'duplicate_titles'],
];

export function canonicalizeCuratedIssues(issues: IssuesResult): IssuesResult {
  const all = [...issues.critical, ...issues.warnings, ...issues.notices];
  const present = new Set(all.map((i) => i.type));

  const drop = new Set<string>();
  for (const order of CURATED_CANONICAL) {
    const winnerIdx = order.findIndex((t) => present.has(t));
    if (winnerIdx === -1) continue;
    order.forEach((t, i) => {
      if (i !== winnerIdx) drop.add(t);
    });
  }

  const keep = (list: Issue[]) => list.filter((i) => !drop.has(i.type));
  return {
    critical: keep(issues.critical),
    warnings: keep(issues.warnings),
    notices: keep(issues.notices),
  };
}
