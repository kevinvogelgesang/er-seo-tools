import { describe, it, expect } from 'vitest';
import { PageSpeedParser } from './pagespeed.parser';

describe('PageSpeedParser', () => {
  describe('static properties', () => {
    it('has filenamePattern of "pagespeed"', () => {
      expect(PageSpeedParser.filenamePattern).toEqual(['pagespeed_all', 'pagespeed']);
    });

    it('matchesFile returns true for filenames containing "pagespeed"', () => {
      expect(PageSpeedParser.matchesFile('pagespeed.csv')).toBe(true);
      expect(PageSpeedParser.matchesFile('pagespeed_report.csv')).toBe(true);
      expect(PageSpeedParser.matchesFile('PAGESPEED.CSV')).toBe(true);
    });

    it('matches pagespeed_all.csv', () => {
      expect(PageSpeedParser.matchesFile('pagespeed_all.csv')).toBe(true);
    });

    it('matchesFile returns false for unrelated filenames', () => {
      expect(PageSpeedParser.matchesFile('images.csv')).toBe(false);
      expect(PageSpeedParser.matchesFile('internal.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new PageSpeedParser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for headers-only CSV', () => {
      const csv = `Address,LCP,FID,CLS,Performance Score`;
      const parser = new PageSpeedParser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  describe('LCP (Largest Contentful Paint)', () => {
    it('categorizes LCP <= 2500ms as good', () => {
      const csv = `Address,LCP
https://example.com/fast,2000
https://example.com/boundary,2500`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.lcp.good).toBe(2);
      expect(result.core_web_vitals.lcp.needs_improvement).toBe(0);
      expect(result.core_web_vitals.lcp.poor).toBe(0);
    });

    it('categorizes LCP 2501–4000ms as needs improvement', () => {
      const csv = `Address,LCP
https://example.com/mid,3000
https://example.com/boundary,4000`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.lcp.good).toBe(0);
      expect(result.core_web_vitals.lcp.needs_improvement).toBe(2);
      expect(result.core_web_vitals.lcp.poor).toBe(0);
    });

    it('categorizes LCP > 4000ms as poor and creates issue', () => {
      const csv = `Address,LCP
https://example.com/slow,5000
https://example.com/very-slow,8000`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.lcp.poor).toBe(2);
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_lcp');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/slow');
      expect(issue.urls).toContain('https://example.com/very-slow');
    });

    it('computes avg_ms for LCP', () => {
      const csv = `Address,LCP
https://example.com/a,2000
https://example.com/b,4000`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.lcp.avg_ms).toBe(3000);
    });

    it('does not create poor_lcp issue when all LCP values are good', () => {
      const csv = `Address,LCP
https://example.com/a,1000
https://example.com/b,2000`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_lcp');
      expect(issue).toBeUndefined();
    });
  });

  describe('FID/INP (First Input Delay / Interaction to Next Paint)', () => {
    it('categorizes FID <= 100ms as good', () => {
      const csv = `Address,FID
https://example.com/fast,50
https://example.com/boundary,100`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.fid.good).toBe(2);
      expect(result.core_web_vitals.fid.poor).toBe(0);
    });

    it('categorizes FID 101–300ms as needs improvement', () => {
      const csv = `Address,FID
https://example.com/mid,200
https://example.com/boundary,300`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.fid.needs_improvement).toBe(2);
    });

    it('categorizes FID > 300ms as poor and creates issue', () => {
      const csv = `Address,FID
https://example.com/slow,400`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.fid.poor).toBe(1);
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_fid');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
    });

    it('accepts INP column name as alias for FID', () => {
      const csv = `Address,INP
https://example.com/slow,400`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.fid).toBeDefined();
      expect(result.core_web_vitals.fid.poor).toBe(1);
    });
  });

  describe('CLS (Cumulative Layout Shift)', () => {
    it('categorizes CLS <= 0.1 as good', () => {
      const csv = `Address,CLS
https://example.com/good,0.05
https://example.com/boundary,0.1`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.cls.good).toBe(2);
      expect(result.core_web_vitals.cls.poor).toBe(0);
    });

    it('categorizes CLS 0.1–0.25 as needs improvement', () => {
      const csv = `Address,CLS
https://example.com/mid,0.15
https://example.com/boundary,0.25`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.cls.needs_improvement).toBe(2);
    });

    it('categorizes CLS > 0.25 as poor and creates issue', () => {
      const csv = `Address,CLS
https://example.com/bad,0.4`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals.cls.poor).toBe(1);
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_cls');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.description).toContain('0.25');
    });

    it('stores CLS avg (not avg_ms) since it is not milliseconds', () => {
      const csv = `Address,CLS
https://example.com/a,0.1
https://example.com/b,0.3`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      // avg should be stored, not avg_ms
      expect(result.core_web_vitals.cls.avg).toBeDefined();
      expect(result.core_web_vitals.cls.avg_ms).toBeUndefined();
    });
  });

  describe('Performance Score', () => {
    it('computes avg_performance_score', () => {
      const csv = `Address,Performance Score
https://example.com/a,80
https://example.com/b,60`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.stats.avg_performance_score).toBe(70);
    });

    it('creates poor_performance_score issue for scores < 50', () => {
      const csv = `Address,Performance Score
https://example.com/good,80
https://example.com/bad,30
https://example.com/terrible,10`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_performance_score');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('critical');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/bad');
      expect(issue.urls).toContain('https://example.com/terrible');
    });

    it('does not create poor_performance_score issue when all scores >= 50', () => {
      const csv = `Address,Performance Score
https://example.com/good,80
https://example.com/ok,50`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_performance_score');
      expect(issue).toBeUndefined();
    });
  });

  describe('threshold boundaries', () => {
    // ── LCP ──────────────────────────────────────────────────────────────────
    // LCP_GOOD = 2500: val <= 2500 → good; val > 2500 → needs_improvement
    it('LCP exactly 2500ms falls in "good" bucket', () => {
      const csv = `Address,LCP\nhttps://example.com/a,2500`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.lcp.good).toBe(1);
      expect(result.core_web_vitals.lcp.needs_improvement).toBe(0);
      expect(result.core_web_vitals.lcp.poor).toBe(0);
    });

    it('LCP exactly 2501ms falls in "needs_improvement" bucket', () => {
      const csv = `Address,LCP\nhttps://example.com/a,2501`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.lcp.good).toBe(0);
      expect(result.core_web_vitals.lcp.needs_improvement).toBe(1);
      expect(result.core_web_vitals.lcp.poor).toBe(0);
    });

    // LCP_POOR = 4000: val <= 4000 → needs_improvement; val > 4000 → poor
    it('LCP exactly 4000ms falls in "needs_improvement" bucket (not poor)', () => {
      const csv = `Address,LCP\nhttps://example.com/a,4000`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.lcp.needs_improvement).toBe(1);
      expect(result.core_web_vitals.lcp.poor).toBe(0);
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_lcp');
      expect(issue).toBeUndefined();
    });

    it('LCP exactly 4001ms falls in "poor" bucket and creates issue', () => {
      const csv = `Address,LCP\nhttps://example.com/a,4001`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.lcp.poor).toBe(1);
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_lcp');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(1);
    });

    // ── FID ──────────────────────────────────────────────────────────────────
    // FID_GOOD = 100: val <= 100 → good; val > 100 → needs_improvement
    it('FID exactly 100ms falls in "good" bucket', () => {
      const csv = `Address,FID\nhttps://example.com/a,100`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.fid.good).toBe(1);
      expect(result.core_web_vitals.fid.needs_improvement).toBe(0);
      expect(result.core_web_vitals.fid.poor).toBe(0);
    });

    it('FID exactly 101ms falls in "needs_improvement" bucket', () => {
      const csv = `Address,FID\nhttps://example.com/a,101`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.fid.good).toBe(0);
      expect(result.core_web_vitals.fid.needs_improvement).toBe(1);
      expect(result.core_web_vitals.fid.poor).toBe(0);
    });

    // FID_POOR = 300: val <= 300 → needs_improvement; val > 300 → poor
    it('FID exactly 300ms falls in "needs_improvement" bucket (not poor)', () => {
      const csv = `Address,FID\nhttps://example.com/a,300`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.fid.needs_improvement).toBe(1);
      expect(result.core_web_vitals.fid.poor).toBe(0);
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_fid');
      expect(issue).toBeUndefined();
    });

    it('FID exactly 301ms falls in "poor" bucket and creates issue', () => {
      const csv = `Address,FID\nhttps://example.com/a,301`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.fid.poor).toBe(1);
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_fid');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
    });

    // ── CLS ──────────────────────────────────────────────────────────────────
    // CLS_GOOD = 0.1: val <= 0.1 → good; val > 0.1 → needs_improvement
    it('CLS exactly 0.1 falls in "good" bucket', () => {
      const csv = `Address,CLS\nhttps://example.com/a,0.1`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.cls.good).toBe(1);
      expect(result.core_web_vitals.cls.needs_improvement).toBe(0);
      expect(result.core_web_vitals.cls.poor).toBe(0);
    });

    it('CLS exactly 0.101 falls in "needs_improvement" bucket', () => {
      const csv = `Address,CLS\nhttps://example.com/a,0.101`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.cls.good).toBe(0);
      expect(result.core_web_vitals.cls.needs_improvement).toBe(1);
      expect(result.core_web_vitals.cls.poor).toBe(0);
    });

    // CLS_POOR = 0.25: val <= 0.25 → needs_improvement; val > 0.25 → poor
    it('CLS exactly 0.25 falls in "needs_improvement" bucket (not poor)', () => {
      const csv = `Address,CLS\nhttps://example.com/a,0.25`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.cls.needs_improvement).toBe(1);
      expect(result.core_web_vitals.cls.poor).toBe(0);
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_cls');
      expect(issue).toBeUndefined();
    });

    it('CLS exactly 0.251 falls in "poor" bucket and creates issue', () => {
      const csv = `Address,CLS\nhttps://example.com/a,0.251`;
      const result = new PageSpeedParser(csv).parse();
      expect(result.core_web_vitals.cls.poor).toBe(1);
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_cls');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
    });

    // ── Performance Score ─────────────────────────────────────────────────────
    // Threshold is score < 50 → poor; score >= 50 → not poor
    it('Performance score of exactly 50 does NOT create poor_performance_score issue', () => {
      const csv = `Address,Performance Score\nhttps://example.com/a,50`;
      const result = new PageSpeedParser(csv).parse();
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_performance_score');
      expect(issue).toBeUndefined();
    });

    it('Performance score of exactly 49 DOES create poor_performance_score issue', () => {
      const csv = `Address,Performance Score\nhttps://example.com/a,49`;
      const result = new PageSpeedParser(csv).parse();
      const issue = result.issues.find((i: { type: string }) => i.type === 'poor_performance_score');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('critical');
      expect(issue.count).toBe(1);
    });
  });

  describe('missing columns', () => {
    it('skips LCP analysis when LCP column is absent', () => {
      const csv = `Address,Performance Score
https://example.com/page,80`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals?.lcp).toBeUndefined();
    });

    it('skips FID analysis when FID/INP column is absent', () => {
      const csv = `Address,LCP
https://example.com/page,2000`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.core_web_vitals?.fid).toBeUndefined();
    });

    it('handles CSV with only LCP column', () => {
      const csv = `Address,LCP
https://example.com/page,3000`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.total_pages).toBe(1);
      expect(result.core_web_vitals.lcp).toBeDefined();
      expect(result.core_web_vitals.fid).toBeUndefined();
      expect(result.core_web_vitals.cls).toBeUndefined();
    });
  });

  describe('total_pages', () => {
    it('reports correct total_pages count', () => {
      const csv = `Address,LCP
https://example.com/a,1000
https://example.com/b,2000
https://example.com/c,5000`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.total_pages).toBe(3);
    });
  });

  describe('all metrics together', () => {
    it('processes all core web vitals and performance score in one parse', () => {
      const csv = `Address,LCP,FID,CLS,Performance Score
https://example.com/good,2000,80,0.05,90
https://example.com/mid,3500,200,0.15,65
https://example.com/bad,5000,400,0.35,30`;

      const parser = new PageSpeedParser(csv);
      const result = parser.parse();

      expect(result.total_pages).toBe(3);
      expect(result.core_web_vitals.lcp.good).toBe(1);
      expect(result.core_web_vitals.lcp.needs_improvement).toBe(1);
      expect(result.core_web_vitals.lcp.poor).toBe(1);
      expect(result.core_web_vitals.fid.poor).toBe(1);
      expect(result.core_web_vitals.cls.poor).toBe(1);
      expect(result.stats.avg_performance_score).toBe(62); // (90+65+30)/3 = 61.67 -> rounded to 62

      const poorLcp = result.issues.find((i: { type: string }) => i.type === 'poor_lcp');
      const poorFid = result.issues.find((i: { type: string }) => i.type === 'poor_fid');
      const poorCls = result.issues.find((i: { type: string }) => i.type === 'poor_cls');
      const poorScore = result.issues.find((i: { type: string }) => i.type === 'poor_performance_score');

      expect(poorLcp).toBeDefined();
      expect(poorFid).toBeDefined();
      expect(poorCls).toBeDefined();
      expect(poorScore).toBeDefined();
    });
  });
});
