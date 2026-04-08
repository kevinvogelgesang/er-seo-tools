import { describe, it, expect } from 'vitest';
import { AllInlinksParser } from './allInlinks.parser';

describe('AllInlinksParser', () => {
  describe('filenamePattern', () => {
    it('matches all_inlinks.csv', () => {
      expect(AllInlinksParser.matchesFile('all_inlinks.csv')).toBe(true);
    });
  });

  describe('parse', () => {
    const baseCsv = `Type,Source,Destination,Anchor,Follow,Status Code,Link Position
Hyperlink,https://ex.com/,https://ex.com/a,About Us,true,200,Content
Hyperlink,https://ex.com/page,https://ex.com/a,About,true,200,Content
Hyperlink,https://ex.com/,https://ex.com/b,Click Here,false,200,Content
Image,https://ex.com/,https://ex.com/img.png,,true,200,Content`;

    it('counts total internal links (Hyperlink type only)', () => {
      const result = new AllInlinksParser(baseCsv).parse();
      expect(result.link_analysis.total_internal_links).toBe(3);
    });

    it('computes nofollow_ratio_pct', () => {
      const result = new AllInlinksParser(baseCsv).parse();
      // 1 of 3 hyperlinks is nofollow → 33.3%
      expect(result.link_analysis.nofollow_ratio_pct).toBe(33.3);
    });

    it('computes top_linked_pages with correct counts', () => {
      const result = new AllInlinksParser(baseCsv).parse();
      expect(result.link_analysis.top_linked_pages[0]).toEqual({
        url: 'https://ex.com/a',
        inlink_count: 2,
      });
    });

    it('computes top_anchor_texts with is_descriptive flag', () => {
      const result = new AllInlinksParser(baseCsv).parse();
      const clickHere = result.link_analysis.top_anchor_texts.find(a => a.anchor_text.toLowerCase() === 'click here');
      expect(clickHere?.is_descriptive).toBe(false);
      const aboutUs = result.link_analysis.top_anchor_texts.find(a => a.anchor_text === 'About Us');
      expect(aboutUs?.is_descriptive).toBe(true);
    });

    it('computes non_descriptive_anchor_pct', () => {
      const result = new AllInlinksParser(baseCsv).parse();
      // 'Click Here' is non-descriptive, 1 of 3 → 33.3%
      expect(result.link_analysis.non_descriptive_anchor_pct).toBe(33.3);
    });

    it('returns empty/zero LinkAnalysis for header-only CSV', () => {
      const csv = `Type,Source,Destination,Anchor,Follow,Status Code,Link Position`;
      const result = new AllInlinksParser(csv).parse();
      expect(result.link_analysis.total_internal_links).toBe(0);
      expect(result.link_analysis.top_linked_pages).toHaveLength(0);
    });
  });
});
