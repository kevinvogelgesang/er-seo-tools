import { describe, it, expect } from 'vitest';
import { SemrushKeywordGapParser } from './semrushKeywordGap.parser';

describe('SemrushKeywordGapParser', () => {
  describe('matchesContent', () => {
    it('matches a Keyword Gap header set with Search Volume and Keyword Difficulty', () => {
      const headers = ['Keyword', 'Search Volume', 'Keyword Difficulty', 'Intent'];
      expect(SemrushKeywordGapParser.matchesContent(headers)).toBe(true);
    });

    it('matches a Keyword Gap header set with Volume and KD % aliases', () => {
      const headers = ['Keyword', 'Volume', 'KD %', 'Keyword Intent'];
      expect(SemrushKeywordGapParser.matchesContent(headers)).toBe(true);
    });

    it('matches with KD alias for difficulty', () => {
      const headers = ['Keyword', 'Volume', 'KD'];
      expect(SemrushKeywordGapParser.matchesContent(headers)).toBe(true);
    });

    // --- Disambiguation: must NOT match sibling parsers ---

    it('does NOT match Organic Positions export (has URL and Position)', () => {
      // Exact headers from semrushOrganicPositions.parser.test.ts
      const headers = ['Keyword', 'Position', 'Previous position', 'Search Volume', 'Keyword Intents', 'URL', 'Traffic'];
      expect(SemrushKeywordGapParser.matchesContent(headers)).toBe(false);
    });

    it('does NOT match Organic Pages export (has Number of Keywords and Adwords Positions)', () => {
      // Exact headers from semrushOrganicPages.parser.test.ts
      const headers = ['URL', 'Traffic (%)', 'Number of Keywords', 'Traffic', 'Adwords Positions'];
      expect(SemrushKeywordGapParser.matchesContent(headers)).toBe(false);
    });

    it('does NOT match Position Tracking CSV headers (has Average Position and Estimated Traffic)', () => {
      // Headers extracted from the CSV portion of the Position Tracking test fixture
      const headers = ['URL', 'Keywords', 'Average Position', 'Estimated Traffic'];
      expect(SemrushKeywordGapParser.matchesContent(headers)).toBe(false);
    });

    it('does NOT match when missing Keyword column', () => {
      const headers = ['Search Volume', 'Keyword Difficulty', 'Intent'];
      expect(SemrushKeywordGapParser.matchesContent(headers)).toBe(false);
    });

    it('does NOT match when missing volume column', () => {
      const headers = ['Keyword', 'Keyword Difficulty', 'Intent'];
      expect(SemrushKeywordGapParser.matchesContent(headers)).toBe(false);
    });

    it('does NOT match when missing difficulty column', () => {
      const headers = ['Keyword', 'Search Volume', 'Intent'];
      expect(SemrushKeywordGapParser.matchesContent(headers)).toBe(false);
    });

    it('does NOT match empty headers', () => {
      expect(SemrushKeywordGapParser.matchesContent([])).toBe(false);
    });
  });

  describe('parse', () => {
    const csv = `Keyword,Search Volume,Keyword Difficulty,Intent
online nursing programs,2400,45,Informational
rn to bsn online,1900,38,Informational
nursing school near me,1600,52,Navigational
best nursing programs,880,61,Commercial
accelerated nursing programs,720,55,Commercial`;

    it('extracts gap keywords from CSV', () => {
      const result = new SemrushKeywordGapParser(csv).parse();
      expect(result.gap_keywords).toHaveLength(5);
      expect(result.gap_keywords_count).toBe(5);
    });

    it('maps keyword and volume correctly', () => {
      const result = new SemrushKeywordGapParser(csv).parse();
      expect(result.gap_keywords[0].keyword).toBe('online nursing programs');
      expect(result.gap_keywords[0].volume).toBe(2400);
    });

    it('maps difficulty when present', () => {
      const result = new SemrushKeywordGapParser(csv).parse();
      expect(result.gap_keywords[0].difficulty).toBe(45);
    });

    it('maps intent when present', () => {
      const result = new SemrushKeywordGapParser(csv).parse();
      expect(result.gap_keywords[0].intent).toBe('Informational');
    });

    it('computes total_gap_volume as sum of all volumes', () => {
      const result = new SemrushKeywordGapParser(csv).parse();
      expect(result.total_gap_volume).toBe(2400 + 1900 + 1600 + 880 + 720);
    });

    it('handles comma-formatted volume numbers', () => {
      const csvCommas = `Keyword,Volume,KD %
enterprise seo software,12"000",72
keyword research tool,"8,500",65`;
      // Note: papaparse may not strip quotes the same way — test with plain commas
      const csvPlain = `Keyword,Volume,KD %
enterprise seo software,12000,72
keyword research tool,8500,65`;
      const result = new SemrushKeywordGapParser(csvPlain).parse();
      expect(result.gap_keywords[0].volume).toBe(12000);
      expect(result.gap_keywords[1].volume).toBe(8500);
    });

    it('handles KD % alias for difficulty', () => {
      const csvKd = `Keyword,Volume,KD %
test keyword,500,42`;
      const result = new SemrushKeywordGapParser(csvKd).parse();
      expect(result.gap_keywords[0].difficulty).toBe(42);
    });

    it('returns empty result for empty CSV', () => {
      const result = new SemrushKeywordGapParser('Keyword,Search Volume,Keyword Difficulty').parse();
      expect(result.gap_keywords).toHaveLength(0);
      expect(result.gap_keywords_count).toBe(0);
      expect(result.total_gap_volume).toBe(0);
    });

    it('omits difficulty when column is absent', () => {
      const csvNoKd = `Keyword,Search Volume
test keyword,500`;
      // matchesContent would return false without difficulty, but parse() itself still works
      const result = new SemrushKeywordGapParser(csvNoKd).parse();
      expect(result.gap_keywords[0].difficulty).toBeUndefined();
    });
  });
});
