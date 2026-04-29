import { describe, it, expect } from 'vitest';
import { buildNarrativePayload } from './narrativePayload';
import type { UrlRecord, PillarTopic, HubRecommendation } from './types';

function urlRecord(over: Partial<UrlRecord>): UrlRecord {
  return {
    url: 'https://example.com/x',
    pageType: 'blog',
    pageTypeConfidence: 0.9,
    title: 'X',
    h1: 'X',
    metaDescription: null,
    firstParagraph: null,
    wordCount: 800,
    crawlDepth: 2,
    inlinks: 5,
    outlinks: 5,
    indexable: true,
    gscClicks: null,
    gscImpressions: null,
    gscCtr: null,
    gscPosition: null,
    ga4Sessions: null,
    ga4EngagementRate: null,
    ga4KeyEvents: null,
    referringDomains: null,
    organicKeywords: null,
    intentClass: 'informational',
    intentConfidence: 0.8,
    topicClusterId: null,
    verdict: 'cluster',
    verdictConfidence: 0.85,
    recommendedPillar: null,
    reasoning: [],
    ...over,
  };
}

function row(args: {
  pillarTopics: PillarTopic[];
  urlVerdicts: UrlRecord[];
  hub?: HubRecommendation;
}) {
  return {
    id: 'pa_1',
    sessionId: 'sess_1',
    status: 'complete',
    error: null,
    score: 8,
    subscores: '{"contentVolume":8,"topicalConcentration":9,"organicFootprint":7,"internalLinkGap":3,"programPageClarity":10,"backlinkDistribution":5}',
    subscorePresence: null,
    subscoreContext: null,
    dataCompleteness: 0.83,
    hubRecommendation: args.hub ? JSON.stringify(args.hub) : '{"primary":"hybrid","alternates":[],"reasoning":[]}',
    pillarTopics: JSON.stringify(args.pillarTopics),
    urlVerdicts: JSON.stringify(args.urlVerdicts),
    createdAt: new Date('2026-04-29T10:00:00Z'),
    updatedAt: new Date('2026-04-29T11:00:00Z'),
  };
}

describe('buildNarrativePayload', () => {
  it('parses subscores, hub, and timestamps from JSON columns', () => {
    const out = buildNarrativePayload(row({ pillarTopics: [], urlVerdicts: [] }));
    expect(out.score).toBe(8);
    expect(out.subscores?.contentVolume).toBe(8);
    expect(out.hubRecommendation?.primary).toBe('hybrid');
    expect(out.createdAt).toBe('2026-04-29T10:00:00.000Z');
    expect(out.updatedAt).toBe('2026-04-29T11:00:00.000Z');
  });

  it('replaces pillarTopics with clusters that include anchor stats and sample members', () => {
    const anchor = urlRecord({
      url: 'https://example.com/programs/cosmetology/',
      pageType: 'program',
      title: 'Cosmetology Program',
      inlinks: 358,
      gscClicks: 24,
      gscImpressions: 2246,
      gscPosition: 24,
      verdict: 'pillar',
    });
    const members = [
      urlRecord({ url: 'https://example.com/blog/cosmetology-careers', verdict: 'cluster' }),
      urlRecord({ url: 'https://example.com/blog/cosmetology-licensing', verdict: 'cluster' }),
    ];
    const out = buildNarrativePayload(row({
      pillarTopics: [{
        clusterId: 1,
        name: 'Cosmetology Program',
        pillarUrl: 'https://example.com/programs/cosmetology/',
        pillarPageType: 'program',
        clusterUrls: members.map(m => m.url),
        size: 2,
      }],
      urlVerdicts: [anchor, ...members],
    }));

    expect(out.clusters).toHaveLength(1);
    const c = out.clusters[0];
    expect(c.name).toBe('Cosmetology Program');
    expect(c.pillarUrl).toBe('https://example.com/programs/cosmetology/');
    expect(c.size).toBe(2);
    expect(c.anchorStats?.inlinks).toBe(358);
    expect(c.anchorStats?.gscImpressions).toBe(2246);
    expect(c.sampleMembers).toHaveLength(2);
    expect(c.sampleMembers[0].url).toBe(members[0].url);
  });

  it('caps sample members at 5 per cluster', () => {
    const memberUrls = Array.from({ length: 12 }, (_, i) => `https://example.com/blog/${i}`);
    const memberRecords = memberUrls.map(u => urlRecord({ url: u, verdict: 'cluster' }));
    const out = buildNarrativePayload(row({
      pillarTopics: [{
        clusterId: 1,
        name: 'Big cluster',
        pillarUrl: null,
        pillarPageType: null,
        clusterUrls: memberUrls,
        size: 12,
      }],
      urlVerdicts: memberRecords,
    }));
    expect(out.clusters[0].size).toBe(12);
    expect(out.clusters[0].sampleMembers).toHaveLength(5);
  });

  it('builds verdictSummary across all six buckets', () => {
    const records: UrlRecord[] = [
      urlRecord({ url: 'a', verdict: 'pillar' }),
      urlRecord({ url: 'b', verdict: 'pillar' }),
      urlRecord({ url: 'c', verdict: 'cluster' }),
      urlRecord({ url: 'd', verdict: 'leave-as-blog' }),
      urlRecord({ url: 'e', verdict: 'consolidate' }),
      urlRecord({ url: 'f', verdict: 'prune' }),
      urlRecord({ url: 'g', verdict: 'excluded' }),
      urlRecord({ url: 'h', verdict: 'excluded' }),
    ];
    const out = buildNarrativePayload(row({ pillarTopics: [], urlVerdicts: records }));
    expect(out.verdictSummary).toEqual({
      pillar: 2,
      cluster: 1,
      'leave-as-blog': 1,
      consolidate: 1,
      prune: 1,
      excluded: 2,
    });
    expect(out.totalUrls).toBe(8);
  });

  it('flags low-confidence cluster/leave-as-blog/consolidate verdicts', () => {
    const records = [
      urlRecord({ url: 'high', verdict: 'cluster', verdictConfidence: 0.9 }),
      urlRecord({ url: 'low1', verdict: 'cluster', verdictConfidence: 0.55, recommendedPillar: 'https://example.com/programs/x' }),
      urlRecord({ url: 'low2', verdict: 'leave-as-blog', verdictConfidence: 0.6 }),
      urlRecord({ url: 'low3', verdict: 'consolidate', verdictConfidence: 0.4 }),
      // Excluded with low confidence should NOT appear in samples (we filter)
      urlRecord({ url: 'low4', verdict: 'excluded', verdictConfidence: 0.3 }),
    ];
    const out = buildNarrativePayload(row({ pillarTopics: [], urlVerdicts: records }));
    expect(out.lowConfidenceAssignments.threshold).toBe(0.7);
    expect(out.lowConfidenceAssignments.count).toBe(3);
    expect(out.lowConfidenceAssignments.samples.map(s => s.url)).toEqual(['low1', 'low2', 'low3']);
  });

  it('caps low-confidence samples at 5 even when count is higher', () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      urlRecord({ url: `low${i}`, verdict: 'cluster', verdictConfidence: 0.5 }),
    );
    const out = buildNarrativePayload(row({ pillarTopics: [], urlVerdicts: records }));
    expect(out.lowConfidenceAssignments.count).toBe(10);
    expect(out.lowConfidenceAssignments.samples).toHaveLength(5);
  });

  it('lists excluded anchor pages (program/location with verdict=excluded)', () => {
    const records = [
      urlRecord({ url: 'https://example.com/programs/tiny', pageType: 'program', verdict: 'excluded', reasoning: ['cluster size below minClusterSize=3'] }),
      urlRecord({ url: 'https://example.com/locations/empty', pageType: 'location', verdict: 'excluded', reasoning: ['no anchor cluster formed'] }),
      // A nav page excluded — should NOT appear (not an anchor type)
      urlRecord({ url: 'https://example.com/about', pageType: 'nav', verdict: 'excluded' }),
      // A program page that succeeded — should NOT appear
      urlRecord({ url: 'https://example.com/programs/big', pageType: 'program', verdict: 'pillar' }),
    ];
    const out = buildNarrativePayload(row({ pillarTopics: [], urlVerdicts: records }));
    expect(out.excludedAnchors).toHaveLength(2);
    expect(out.excludedAnchors.map(a => a.pageType).sort()).toEqual(['location', 'program']);
    expect(out.excludedAnchors[0].reasoning.length).toBeGreaterThan(0);
  });

  it('handles malformed JSON gracefully (parse failures become null/empty)', () => {
    const out = buildNarrativePayload({
      id: 'pa_x',
      sessionId: 'sess_x',
      status: 'complete',
      error: null,
      score: 5,
      subscores: 'not-json',
      subscorePresence: null,
      subscoreContext: null,
      dataCompleteness: 0.5,
      hubRecommendation: 'broken',
      pillarTopics: '[[',
      urlVerdicts: 'oops',
      createdAt: new Date('2026-04-29T10:00:00Z'),
      updatedAt: new Date('2026-04-29T10:00:00Z'),
    });
    expect(out.subscores).toBeNull();
    expect(out.hubRecommendation).toBeNull();
    expect(out.clusters).toEqual([]);
    expect(out.totalUrls).toBe(0);
    expect(out.verdictSummary.pillar).toBe(0);
  });
});
