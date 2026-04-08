import { describe, it, expect } from 'vitest';
import { SemrushOrganicPagesParser } from './semrushOrganicPages.parser';

describe('SemrushOrganicPagesParser', () => {
  describe('matchesContent', () => {
    it('matches when Number of Keywords and Adwords Positions present', () => {
      const headers = ['URL', 'Traffic (%)', 'Number of Keywords', 'Traffic', 'Adwords Positions'];
      expect(SemrushOrganicPagesParser.matchesContent(headers)).toBe(true);
    });
    it('does not match Organic Positions export (missing Number of Keywords)', () => {
      const headers = ['Keyword', 'Position', 'Search Volume', 'Keyword Intents', 'URL', 'Traffic'];
      expect(SemrushOrganicPagesParser.matchesContent(headers)).toBe(false);
    });
  });

  describe('parse', () => {
    const csv = `URL,Traffic (%),Number of Keywords,Traffic,Adwords Positions,Intents - Informational,Intents - Commercial,Intents - Navigational,Intents - Transactional
https://example.com/nursing,45.2,125,3500,0,80,30,10,5
https://example.com/programs,30.1,80,2300,0,20,50,5,5
https://example.com/about,10.5,20,800,0,5,5,60,5
https://example.com/contact,5.2,10,400,0,2,2,80,5`;

    it('extracts top pages sorted by traffic descending', () => {
      const result = new SemrushOrganicPagesParser(csv).parse();
      expect(result.top_pages_by_organic_traffic[0].url).toBe('https://example.com/nursing');
      expect(result.top_pages_by_organic_traffic[0].estimated_monthly_traffic).toBe(3500);
    });

    it('extracts all required fields correctly', () => {
      const result = new SemrushOrganicPagesParser(csv).parse();
      const nursing = result.top_pages_by_organic_traffic[0];
      expect(nursing.keyword_count).toBe(125);
      expect(nursing.traffic_share_pct).toBe(45.2);
    });

    it('determines dominant intent from intent columns', () => {
      const result = new SemrushOrganicPagesParser(csv).parse();
      // nursing: Informational=80 is highest
      expect(result.top_pages_by_organic_traffic[0].dominant_intent).toBe('Informational');
      // programs: Commercial=50 is highest
      expect(result.top_pages_by_organic_traffic[1].dominant_intent).toBe('Commercial');
      // about: Navigational=60 is highest
      expect(result.top_pages_by_organic_traffic[2].dominant_intent).toBe('Navigational');
    });

    it('caps at top 20 pages', () => {
      // Generate 25 rows
      const header = `URL,Traffic (%),Number of Keywords,Traffic,Adwords Positions`;
      const rows = Array.from({ length: 25 }, (_, i) =>
        `https://example.com/page${i},${i},${i * 2},${1000 - i * 10},0`
      ).join('\n');
      const result = new SemrushOrganicPagesParser(`${header}\n${rows}`).parse();
      expect(result.top_pages_by_organic_traffic).toHaveLength(20);
    });

    it('falls back to unknown when no intent columns present', () => {
      const csvNoIntent = `URL,Traffic (%),Number of Keywords,Traffic,Adwords Positions
https://example.com/nursing,45.2,125,3500,0`;
      const result = new SemrushOrganicPagesParser(csvNoIntent).parse();
      expect(result.top_pages_by_organic_traffic[0].dominant_intent).toBe('unknown');
    });
  });
});
