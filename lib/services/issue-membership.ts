import { Issue, PageIndexEntry, UrlRef, UrlKind, PerUrlRecord } from '../types';
import { UrlRegistryBuilder } from './url-registry';

const DERIVABLE_COMPLETE = new Set([
  'missing_title', 'missing_h1', 'missing_meta_description', 'thin_content',
]);

export function kindForIssueType(type: string): UrlKind {
  if (['broken_images', 'large_images', 'very_large_images', 'broken_js', 'large_js_files', 'broken_css', 'large_css_files', 'broken_pdfs', 'large_pdfs'].includes(type)) return 'resource';
  if (type === 'broken_external_links') return 'external';
  if (['redirect_chains', 'long_redirect_chains', 'temporary_redirects'].includes(type)) return 'redirect-target';
  if (['sitemap_errors', 'sitemap_redirects', 'non_indexable_in_sitemap'].includes(type)) return 'sitemap';
  if (type.startsWith('missing_hreflang') || type === 'broken_hreflang_targets') return 'hreflang';
  return 'page';
}

export function deriveIssueTypesForPage(r: PerUrlRecord): string[] {
  if (!r.indexable) return [];
  const t: string[] = [];
  if (r.title == null || r.title === '') t.push('missing_title');
  if (r.h1 == null || r.h1 === '') t.push('missing_h1');
  if (r.metaDescription == null || r.metaDescription === '') t.push('missing_meta_description');
  if (r.wordCount != null && r.wordCount > 0 && r.wordCount < 300) t.push('thin_content');
  return t;
}

export function buildAffectedRefs(
  issue: Issue,
  pageIndex: PageIndexEntry[],
  builder: UrlRegistryBuilder,
): { refs: UrlRef[]; complete: boolean; source: 'derived-page-index' | 'parser-sample' } {
  const kind = kindForIssueType(issue.type);
  const refs = new Set<UrlRef>();
  for (const u of issue.urls ?? []) refs.add(builder.intern(u, kind));
  for (const p of pageIndex) {
    if (p.issueTypes.includes(issue.type)) refs.add(p.ref);
  }
  const complete = DERIVABLE_COMPLETE.has(issue.type) && pageIndex.length > 0;
  return { refs: [...refs], complete, source: complete ? 'derived-page-index' : 'parser-sample' };
}
