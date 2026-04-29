// lib/services/pillarAnalysis/extractors.ts
import type { GscPerUrl, Ga4PerUrl, SemrushPerUrl } from './joinRecords';

export interface RawGscRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface RawGa4Row {
  url: string;
  sessions: number;
  engagementRate: number;
  keyEvents: number;
}

export interface RawSemrushRow {
  url: string;
  referringDomains: number;
  organicKeywords: number;
}

export function gscMapFromParser(rows: RawGscRow[]): Map<string, GscPerUrl> {
  const m = new Map<string, GscPerUrl>();
  for (const r of rows) {
    if (!r.url) continue;
    m.set(r.url, {
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    });
  }
  return m;
}

export function ga4MapFromParser(rows: RawGa4Row[]): Map<string, Ga4PerUrl> {
  const m = new Map<string, Ga4PerUrl>();
  for (const r of rows) {
    if (!r.url) continue;
    m.set(r.url, {
      sessions: r.sessions,
      engagementRate: r.engagementRate,
      keyEvents: r.keyEvents,
    });
  }
  return m;
}

export function semrushMapFromParser(rows: RawSemrushRow[]): Map<string, SemrushPerUrl> {
  const m = new Map<string, SemrushPerUrl>();
  for (const r of rows) {
    if (!r.url) continue;
    m.set(r.url, {
      referringDomains: r.referringDomains,
      organicKeywords: r.organicKeywords,
    });
  }
  return m;
}
