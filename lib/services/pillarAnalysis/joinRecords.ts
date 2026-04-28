// lib/services/pillarAnalysis/joinRecords.ts
import type { UrlRecord } from './types';
import { classifyPageType } from './pageType';
import { classifyIntent } from './intent';

export interface RawUrlData {
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  firstParagraph: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  inlinks: number | null;
  outlinks: number | null;
  indexable: boolean;
  schemaTypes: string[];
}

export interface GscPerUrl {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Ga4PerUrl {
  sessions: number;
  engagementRate: number;
  keyEvents: number;
}

export interface SemrushPerUrl {
  referringDomains: number;
  organicKeywords: number;
}

export interface JoinInput {
  internalRows: RawUrlData[];
  gsc: Map<string, GscPerUrl>;
  ga4: Map<string, Ga4PerUrl>;
  semrush: Map<string, SemrushPerUrl>;
}

/**
 * Joins per-URL data from all parsers, classifies page type and intent,
 * and returns a UrlRecord array. Topic clustering and verdict assignment
 * happen later (separate modules).
 */
export function joinUrlRecords(input: JoinInput): UrlRecord[] {
  return input.internalRows.map((row) => {
    const { pageType, pageTypeConfidence } = classifyPageType({
      url: row.url,
      schemaTypes: row.schemaTypes,
      crawlDepth: row.crawlDepth,
    });
    const { intentClass, intentConfidence } = classifyIntent({
      title: row.title,
      h1: row.h1,
      url: row.url,
      pageType,
      schemaTypes: row.schemaTypes,
    });

    const gsc = input.gsc.get(row.url) ?? null;
    const ga4 = input.ga4.get(row.url) ?? null;
    const sem = input.semrush.get(row.url) ?? null;

    return {
      url: row.url,
      pageType,
      pageTypeConfidence,
      title: row.title,
      h1: row.h1,
      metaDescription: row.metaDescription,
      firstParagraph: row.firstParagraph,
      wordCount: row.wordCount,
      crawlDepth: row.crawlDepth,
      inlinks: row.inlinks,
      outlinks: row.outlinks,
      indexable: row.indexable,
      gscClicks: gsc?.clicks ?? null,
      gscImpressions: gsc?.impressions ?? null,
      gscCtr: gsc?.ctr ?? null,
      gscPosition: gsc?.position ?? null,
      ga4Sessions: ga4?.sessions ?? null,
      ga4EngagementRate: ga4?.engagementRate ?? null,
      ga4KeyEvents: ga4?.keyEvents ?? null,
      referringDomains: sem?.referringDomains ?? null,
      organicKeywords: sem?.organicKeywords ?? null,
      intentClass,
      intentConfidence,
      topicClusterId: null,
      verdict: 'unclear',
      verdictConfidence: 0,
      recommendedPillar: null,
      reasoning: [],
    };
  });
}
