import { describe, it, expect } from 'vitest';
import { buildAffectedRefs } from './issue-membership';
import { UrlRegistryBuilder } from './url-registry';
import { PageIndexEntry, Issue } from '../types';

describe('buildAffectedRefs', () => {
  it('interns an issue url list with the issue-type-appropriate kind', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'x.edu' });
    const issue: Issue = { type: 'missing_title', severity: 'critical', count: 2, description: '', urls: ['https://x.edu/a', 'https://x.edu/b'] };
    const { refs, complete, source } = buildAffectedRefs(issue, [], b);
    expect(refs).toHaveLength(2);
    expect(complete).toBe(true);
    expect(source).toBe('derived-page-index');
  });
  it('recovers capped URLs from independently-derived page-index issue types', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'x.edu' });
    const pageIndex: PageIndexEntry[] = [
      { ref: b.intern('https://x.edu/a', 'page'), title: null, h1: '', metaDescription: '', wordCount: 0, crawlDepth: 0, indexable: true, issueTypes: ['missing_title'] },
      { ref: b.intern('https://x.edu/c', 'page'), title: null, h1: '', metaDescription: '', wordCount: 0, crawlDepth: 0, indexable: true, issueTypes: ['missing_title'] },
    ];
    const issue: Issue = { type: 'missing_title', severity: 'critical', count: 2, description: '', urls: ['https://x.edu/a'] };
    const { refs } = buildAffectedRefs(issue, pageIndex, b);
    expect(new Set(refs).size).toBe(2);
  });
  it('marks non-derivable issue types as parser-sample', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'x.edu' });
    const issue: Issue = { type: 'broken_external_links', severity: 'warning', count: 1, description: '', urls: ['http://dead.example.com/x'] };
    const { complete, source } = buildAffectedRefs(issue, [], b);
    expect(complete).toBe(false);
    expect(source).toBe('parser-sample');
  });
});
