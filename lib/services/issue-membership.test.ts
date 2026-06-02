import { describe, it, expect } from 'vitest';
import { buildAffectedRefs, deriveIssueTypesForPage, kindForIssueType } from './issue-membership';
import { UrlRegistryBuilder } from './url-registry';
import { PageIndexEntry, Issue, PerUrlRecord } from '../types';

const page = (b: UrlRegistryBuilder, url: string, issueTypes: string[]): PageIndexEntry => ({
  ref: b.intern(url, 'page'), title: null, h1: '', metaDescription: '', wordCount: 0, crawlDepth: 0, indexable: true, issueTypes,
});

describe('kindForIssueType', () => {
  it('maps resource/external/page types', () => {
    expect(kindForIssueType('broken_images')).toBe('resource');
    expect(kindForIssueType('broken_external_links')).toBe('external');
    expect(kindForIssueType('missing_title')).toBe('page');
  });
});

describe('deriveIssueTypesForPage', () => {
  it('derives missing elements + thin content for indexable pages', () => {
    const r: PerUrlRecord = { url: 'https://x.edu/a', title: null, h1: '', metaDescription: '', wordCount: 100, crawlDepth: 0, indexable: true };
    expect(deriveIssueTypesForPage(r)).toEqual(expect.arrayContaining(['missing_title','missing_h1','missing_meta_description','thin_content']));
  });
  it('returns nothing for non-indexable pages', () => {
    const r: PerUrlRecord = { url: 'https://x.edu/n', title: null, h1: null, metaDescription: null, wordCount: 0, crawlDepth: 0, indexable: false };
    expect(deriveIssueTypesForPage(r)).toEqual([]);
  });
  it('does not flag thin_content when wordCount is 0 (missing data, not thin)', () => {
    const r: PerUrlRecord = { url: 'https://x.edu/z', title: 'T', h1: 'H', metaDescription: 'M', wordCount: 0, crawlDepth: 0, indexable: true };
    expect(deriveIssueTypesForPage(r)).not.toContain('thin_content');
  });
});

describe('buildAffectedRefs', () => {
  it('interns issue urls with the right kind and is complete when a page index is present', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'x.edu' });
    const pageIndex = [page(b, 'https://x.edu/a', ['missing_title']), page(b, 'https://x.edu/b', ['missing_title'])];
    const issue: Issue = { type: 'missing_title', severity: 'critical', count: 2, description: '', urls: ['https://x.edu/a', 'https://x.edu/b'] };
    const { refs, complete, source } = buildAffectedRefs(issue, pageIndex, b);
    expect(refs).toHaveLength(2);
    expect(complete).toBe(true);
    expect(source).toBe('derived-page-index');
  });
  it('recovers capped URLs from independently-derived page-index issue types', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'x.edu' });
    const pageIndex = [page(b, 'https://x.edu/a', ['missing_title']), page(b, 'https://x.edu/c', ['missing_title'])];
    const issue: Issue = { type: 'missing_title', severity: 'critical', count: 2, description: '', urls: ['https://x.edu/a'] };
    const { refs } = buildAffectedRefs(issue, pageIndex, b);
    expect(new Set(refs).size).toBe(2);
    expect(refs).toContain(b.intern('https://x.edu/c', 'page'));
  });
  it('is NOT complete for a derivable type when the page index is empty', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'x.edu' });
    const issue: Issue = { type: 'missing_title', severity: 'critical', count: 1, description: '', urls: ['https://x.edu/a'] };
    const { complete, source } = buildAffectedRefs(issue, [], b);
    expect(complete).toBe(false);
    expect(source).toBe('parser-sample');
  });
  it('marks non-derivable issue types as parser-sample', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'x.edu' });
    const issue: Issue = { type: 'broken_external_links', severity: 'warning', count: 1, description: '', urls: ['http://dead.example.com/x'] };
    const { complete, source } = buildAffectedRefs(issue, [], b);
    expect(complete).toBe(false);
    expect(source).toBe('parser-sample');
  });
});
