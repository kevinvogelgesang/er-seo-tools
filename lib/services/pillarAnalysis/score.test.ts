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

  it('returns a subscoreContext with the expected counts', () => {
    const records = Array.from({ length: 30 }, () => infoBlog());
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(typeof r.subscoreContext.informationalCount).toBe('number');
    expect(typeof r.subscoreContext.programCount).toBe('number');
    expect(typeof r.subscoreContext.locationCount).toBe('number');
    expect(typeof r.subscoreContext.validClusterCount).toBe('number');
    expect(r.subscoreContext.informationalCount).toBe(30);
    expect(r.subscoreContext.programCount).toBe(0);
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

  it('viability gate: site with 0 informational and 0 anchors scores 1', () => {
    // Simulate a site that's all-nav/home — no blog/news/resource, no program/location
    const records: UrlRecord[] = [
      // home page
      {
        url: 'https://e.edu/', pageType: 'home', pageTypeConfidence: 0.95,
        title: 'Home', h1: 'Home', metaDescription: null, firstParagraph: null,
        wordCount: 500, crawlDepth: 0, inlinks: 30, outlinks: 15, indexable: true,
        gscClicks: 200, gscImpressions: 1000, gscCtr: 0.2, gscPosition: 5.0,
        ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
        referringDomains: null, organicKeywords: null,
        intentClass: 'navigational', intentConfidence: 0.8,
        topicClusterId: null, verdict: 'excluded', verdictConfidence: 0,
        recommendedPillar: null, reasoning: [],
      },
      // nav pages (multiple)
      ...Array.from({ length: 5 }, (_, i) => ({
        url: `https://e.edu/nav-${i}`, pageType: 'nav' as const, pageTypeConfidence: 0.85,
        title: `Nav ${i}`, h1: `Nav ${i}`, metaDescription: null, firstParagraph: null,
        wordCount: 300, crawlDepth: 1, inlinks: 5, outlinks: 5, indexable: true,
        gscClicks: 0, gscImpressions: 0, gscCtr: 0, gscPosition: 0,
        ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
        referringDomains: null, organicKeywords: null,
        intentClass: 'navigational' as const, intentConfidence: 0.8,
        topicClusterId: null, verdict: 'excluded' as const, verdictConfidence: 0,
        recommendedPillar: null, reasoning: [],
      })),
    ];
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('viability gate: site with 0 informational but program anchors caps at 2', () => {
    // Programs exist but no blog/news/resource content
    const records: UrlRecord[] = [
      {
        url: 'https://e.edu/programs/x', pageType: 'program', pageTypeConfidence: 0.85,
        title: 'X Program', h1: 'X', metaDescription: null, firstParagraph: null,
        wordCount: 800, crawlDepth: 1, inlinks: 25, outlinks: 12, indexable: true,
        gscClicks: 50, gscImpressions: 500, gscCtr: 0.1, gscPosition: 7.0,
        ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
        referringDomains: 5, organicKeywords: 30,
        intentClass: 'transactional', intentConfidence: 0.9,
        topicClusterId: null, verdict: 'excluded', verdictConfidence: 0,
        recommendedPillar: null, reasoning: [],
      },
    ];
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(r.score).toBeLessThanOrEqual(2);
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

  it('subscorePresence: backlinkDistribution=false when Semrush data exists but no informational pages', () => {
    // Site has Semrush data on a program page but ZERO informational content.
    // Even though referringDomains is populated somewhere in records,
    // backlinkDistributionScore is called on `informational` (empty), so it
    // returns its 5 fallback. Presence must report false so the UI shows N/A
    // rather than rendering the misleading fallback as a "Moderate" score.
    const records: UrlRecord[] = [
      {
        url: 'https://e.edu/programs/x', pageType: 'program', pageTypeConfidence: 0.85,
        title: 'X', h1: 'X', metaDescription: null, firstParagraph: null,
        wordCount: 800, crawlDepth: 1, inlinks: 25, outlinks: 12, indexable: true,
        gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null,
        ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
        referringDomains: 8, organicKeywords: 50,
        intentClass: 'transactional', intentConfidence: 0.9,
        topicClusterId: null, verdict: 'excluded', verdictConfidence: 0,
        recommendedPillar: null, reasoning: [],
      },
    ];
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(r.subscorePresence.backlinkDistribution).toBe(false);
    expect(r.subscorePresence.organicFootprint).toBe(false);
    expect(r.subscorePresence.internalLinkGap).toBe(false);
  });
});
