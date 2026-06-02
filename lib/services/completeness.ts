import type { AggregatedResult, Completeness, Issue } from '@/lib/types';

// Above this share of issues lacking any affected URL, a crawl that DID include
// the internal export is still only "partial" — too much can't be acted on.
const NO_URL_PARTIAL_THRESHOLD = 0.5;

function hasNoUrls(issue: Issue): boolean {
  return (issue.affectedUrlRefs?.length ?? 0) === 0 && (issue.urls?.length ?? 0) === 0;
}

/**
 * Post-parse completeness verdict. The dominant signal is the page index: an
 * empty one means the Screaming Frog internal crawl wasn't uploaded, so the
 * on-page content + internal-link layers (and most affected-URL lists) are
 * absent — a hollow audit. With a crawl present, a high no-URL issue ratio
 * downgrades to "partial".
 */
export function computeCompleteness(result: AggregatedResult): Completeness {
  const pageIndexCount = result.page_index?.length ?? 0;
  const hasInternalCrawl = pageIndexCount > 0;

  const issues = [
    ...result.issues.critical,
    ...result.issues.warnings,
    ...result.issues.notices,
  ];
  const totalIssues = issues.length;
  const noUrlIssues = issues.filter(hasNoUrls).length;
  const noUrlIssueRatio = totalIssues === 0 ? 0 : noUrlIssues / totalIssues;

  const missingInputs: string[] = [];
  let verdict: Completeness['verdict'];
  let message = '';

  if (!hasInternalCrawl) {
    verdict = 'thin';
    missingInputs.push('Internal crawl (Screaming Frog internal_all export)');
    message =
      'No internal crawl detected — on-page content (titles, meta, H1, thin content) and ' +
      'internal-link analysis are missing, and most issues have no affected URLs. Re-export ' +
      'with the Screaming Frog internal_all crawl for a complete audit.';
  } else if (noUrlIssueRatio > NO_URL_PARTIAL_THRESHOLD) {
    verdict = 'partial';
    message =
      `Partial data — ${Math.round(noUrlIssueRatio * 100)}% of issues have no affected URLs, ` +
      `so parts of this audit can't be acted on directly. Confirm all relevant Screaming Frog ` +
      `exports were included.`;
  } else {
    verdict = 'complete';
  }

  return {
    verdict,
    pageIndexCount,
    totalIssues,
    noUrlIssues,
    noUrlIssueRatio,
    hasInternalCrawl,
    missingInputs,
    message,
  };
}
