import { describe, it, expect } from 'vitest';
import { computeFitScore } from './score';
import type { UrlRecord } from './types';
import { DEFAULT_CONFIG } from './config';

function infoBlog(extras: Partial<UrlRecord> = {}): UrlRecord {
  return {
    url: 'https://e.edu/blog/' + Math.random().toString(36).slice(2, 8),
    pageType: 'blog',
    pageTypeConfidence: 0.85,
    title: 't', h1: 'h', metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 3, outlinks: 5, indexable: true,
    gscClicks: 0, gscImpressions: 0, gscCtr: 0, gscPosition: 0,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: 0, verdict: 'excluded', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
    ...extras,
  };
}

describe('computeFitScore', () => {
  it('thin site (5 posts, no clusters, no GSC) scores low', () => {
    const records = Array.from({ length: 5 }, () => infoBlog({ topicClusterId: -1 }));
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(r.score).toBeLessThanOrEqual(4);
    expect(r.dataCompleteness).toBeLessThan(1.0);
  });

  it('rich site (60 posts + 1 program, 5 clusters, GSC + backlinks) scores high', () => {
    const records: UrlRecord[] = [];
    records.push(infoBlog({
      pageType: 'program',
      intentClass: 'transactional',
      intentConfidence: 0.9,
      topicClusterId: null,
      gscImpressions: 100,
    }));
    for (let cluster = 0; cluster < 5; cluster++) {
      for (let i = 0; i < 12; i++) {
        records.push(infoBlog({
          topicClusterId: cluster,
          gscImpressions: 500,
          referringDomains: 1,
          inlinks: 5,
        }));
      }
    }
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(r.score).toBeGreaterThanOrEqual(7);
    expect(r.dataCompleteness).toBeCloseTo(1.0, 1);
  });

  it('all subscores between 0 and 10', () => {
    const records = Array.from({ length: 30 }, () => infoBlog());
    const r = computeFitScore(records, DEFAULT_CONFIG);
    for (const v of Object.values(r.subscores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
    expect(r.score).toBeGreaterThanOrEqual(1);
    expect(r.score).toBeLessThanOrEqual(10);
  });

  it('dataCompleteness reflects which subscores had real input', () => {
    const records = Array.from({ length: 30 }, () => infoBlog({
      gscImpressions: null,
      gscClicks: null,
      referringDomains: null,
    }));
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(r.dataCompleteness).toBeLessThan(1.0);
  });

  it('subscorePresence flags absent signals (gsc/backlinks) and present signals', () => {
    const records = Array.from({ length: 30 }, () => infoBlog({
      gscImpressions: null,
      referringDomains: null,
      // inlinks defaults to 3 in the helper, so internalLinkGap is present
    }));
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(r.subscorePresence.organicFootprint).toBe(false);
    expect(r.subscorePresence.backlinkDistribution).toBe(false);
    expect(r.subscorePresence.contentVolume).toBe(true);
    expect(r.subscorePresence.internalLinkGap).toBe(true);
    // When a signal is absent, the subscore is substituted with neutral 5.0
    expect(r.subscores.organicFootprint).toBe(5);
    expect(r.subscores.backlinkDistribution).toBe(5);
  });

  it('subscorePresence is all true when every signal is provided', () => {
    const records: UrlRecord[] = [];
    records.push(infoBlog({
      pageType: 'program',
      intentClass: 'transactional',
      intentConfidence: 0.9,
      topicClusterId: null,
      gscImpressions: 100,
    }));
    for (let cluster = 0; cluster < 5; cluster++) {
      for (let i = 0; i < 12; i++) {
        records.push(infoBlog({
          topicClusterId: cluster,
          gscImpressions: 500,
          referringDomains: 1,
          inlinks: 5,
        }));
      }
    }
    const r = computeFitScore(records, DEFAULT_CONFIG);
    for (const v of Object.values(r.subscorePresence)) {
      expect(v).toBe(true);
    }
  });
});
