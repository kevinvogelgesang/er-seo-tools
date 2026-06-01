import { describe, it, expect } from 'vitest';
import { buildStructuredRecommendations } from './recommendation-builder';
import type { AggregatedResult } from '@/lib/types';

function makeResult(): AggregatedResult {
  return {
    crawl_summary: {} as AggregatedResult['crawl_summary'],
    issues: {
      critical: [{ type: 'missing_title', severity: 'critical', count: 2, description: '',
        affectedUrlRefs: [0, 1], affectedUrlRefsComplete: true, affectedUrlSource: 'derived-page-index' }],
      warnings: [{ type: 'thin_content', severity: 'warning', count: 1, description: '',
        affectedUrlRefs: [1], affectedUrlRefsComplete: true, affectedUrlSource: 'derived-page-index' }],
      notices: [],
    },
    site_structure: {} as AggregatedResult['site_structure'],
    resources: {} as AggregatedResult['resources'],
    technical_seo: {} as AggregatedResult['technical_seo'],
    performance: {} as AggregatedResult['performance'],
    recommendations: [],
    metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0 },
    url_registry: { sessionOrigin: { scheme: 'https', host: 'x.edu' }, hosts: ['x.edu'],
      urls: [ { id: 0, kind: 'page', scheme: 'https', hostId: 0, path: '/a' }, { id: 1, kind: 'page', scheme: 'https', hostId: 0, path: '/b' } ] },
  } as AggregatedResult;
}

describe('buildStructuredRecommendations', () => {
  it('produces one recommendation per issue with effort, guidance, counts and a stable hash', () => {
    const recs = buildStructuredRecommendations(makeResult());
    const mt = recs.find(r => r.issueType === 'missing_title')!;
    expect(mt.severity).toBe('critical');
    expect(mt.count).toBe(2);
    expect(mt.affectedUrlCount).toBe(2);
    expect(['low','medium','high']).toContain(mt.effort);
    expect(mt.fixGuidance).toContain('2');
    expect(mt.affectedUrlComplete).toBe(true);
    expect(typeof mt.affectedSetHash).toBe('string');
    expect(mt.affectedSetHash.length).toBeGreaterThan(0);
  });
  it('hash is stable across calls and differs by issue', () => {
    const a = buildStructuredRecommendations(makeResult());
    const b = buildStructuredRecommendations(makeResult());
    expect(a[0].affectedSetHash).toBe(b[0].affectedSetHash);
    expect(a[0].affectedSetHash).not.toBe(a[1].affectedSetHash);
  });
  it('orders critical before warning before notice', () => {
    const recs = buildStructuredRecommendations(makeResult());
    expect(recs[0].severity).toBe('critical');
  });
});
