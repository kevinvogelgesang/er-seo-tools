import { describe, it, expect } from 'vitest';
import { gscMapFromParser, ga4MapFromParser, semrushMapFromParser } from './extractors';

describe('extractors', () => {
  it('builds GSC map from per-URL rows', () => {
    const rows = [
      { url: 'https://e.edu/a', clicks: 10, impressions: 200, ctr: 0.05, position: 5.2 },
      { url: 'https://e.edu/b', clicks: 3, impressions: 50, ctr: 0.06, position: 12.0 },
    ];
    const m = gscMapFromParser(rows);
    expect(m.size).toBe(2);
    expect(m.get('https://e.edu/a')!.clicks).toBe(10);
  });

  it('handles missing/null fields by skipping the row', () => {
    const rows = [
      { url: '', clicks: 10, impressions: 200, ctr: 0.05, position: 5.2 },
      { url: 'https://e.edu/x', clicks: 0, impressions: 0, ctr: 0, position: 0 },
    ];
    const m = gscMapFromParser(rows);
    expect(m.size).toBe(1);
  });

  it('builds GA4 map', () => {
    const rows = [
      { url: 'https://e.edu/a', sessions: 100, engagementRate: 0.6, keyEvents: 5 },
    ];
    expect(ga4MapFromParser(rows).get('https://e.edu/a')!.sessions).toBe(100);
  });

  it('builds Semrush map', () => {
    const rows = [
      { url: 'https://e.edu/a', referringDomains: 12, organicKeywords: 30 },
    ];
    expect(semrushMapFromParser(rows).get('https://e.edu/a')!.referringDomains).toBe(12);
  });
});
