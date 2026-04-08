import { describe, it, expect } from 'vitest';
import { SemrushOrganicPositionsParser } from './semrushOrganicPositions.parser';

describe('SemrushOrganicPositionsParser', () => {
  describe('matchesContent', () => {
    it('matches when required headers present', () => {
      const headers = ['Keyword', 'Position', 'Previous position', 'Search Volume', 'Keyword Intents', 'URL', 'Traffic'];
      expect(SemrushOrganicPositionsParser.matchesContent(headers)).toBe(true);
    });
    it('does not match when missing required header', () => {
      const headers = ['Keyword', 'Position', 'Search Volume', 'URL']; // missing Keyword Intents
      expect(SemrushOrganicPositionsParser.matchesContent(headers)).toBe(false);
    });
    it('does not match when headers are empty', () => {
      expect(SemrushOrganicPositionsParser.matchesContent([])).toBe(false);
    });
  });

  describe('parse', () => {
    const csv = `Keyword,Position,Previous position,Search Volume,Keyword Difficulty,CPC,URL,Traffic,Traffic (%),Traffic Cost,Competition,Number of Results,Trends,Timestamp,SERP Features by Keyword,Keyword Intents,Position Type
nursing programs,5,6,1200,45,2.50,https://example.com/nursing,120,10.5,,,,,,,"Informational|Commercial",Organic
nursing programs,15,16,1200,45,2.50,https://example.com/nursing-grad,20,1.5,,,,,,,"Informational|Commercial",Organic
best nursing schools,3,3,800,55,3.00,https://example.com/nursing,90,11.2,,,,,,,"Commercial",Organic
online courses,12,11,500,30,1.20,https://example.com/online,40,8.0,,,,,,,"Informational",Organic`;

    it('counts total ranking keywords', () => {
      const result = new SemrushOrganicPositionsParser(csv).parse();
      expect(result.total_ranking_keywords).toBe(4);
    });

    it('detects keyword cannibalization when 2+ URLs rank for same keyword', () => {
      const result = new SemrushOrganicPositionsParser(csv).parse();
      expect(result.keyword_cannibalization).toHaveLength(1);
      expect(result.keyword_cannibalization[0].keyword).toBe('nursing programs');
      expect(result.keyword_cannibalization[0].competing_urls).toHaveLength(2);
      expect(result.keyword_cannibalization[0].competing_urls[0].position).toBe(5); // sorted by position asc
    });

    it('identifies quick wins (position 11-20, volume >= 100)', () => {
      const result = new SemrushOrganicPositionsParser(csv).parse();
      // nursing programs at pos 15 (vol 1200) and online courses at pos 12 (vol 500) are quick wins
      expect(result.quick_wins).toHaveLength(2);
      expect(result.quick_wins[0].keyword).toBe('nursing programs'); // higher volume first
      expect(result.quick_wins[0].position).toBe(15);
    });

    it('builds per_url_keyword_data map with top 3 keywords by traffic', () => {
      const result = new SemrushOrganicPositionsParser(csv).parse();
      const nursingPage = result.per_url_keyword_data.get('https://example.com/nursing');
      expect(nursingPage).toBeDefined();
      expect(nursingPage!.length).toBeLessThanOrEqual(3);
      expect(nursingPage![0].keyword).toBe('nursing programs'); // highest traffic (120 > 90)
    });

    it('uses first pipe-separated intent as primary intent', () => {
      const result = new SemrushOrganicPositionsParser(csv).parse();
      const qw = result.quick_wins.find(q => q.keyword === 'nursing programs');
      expect(qw?.intent).toBe('Informational');
    });
  });
});
