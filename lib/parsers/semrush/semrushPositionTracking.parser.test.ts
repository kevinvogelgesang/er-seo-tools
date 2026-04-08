import { describe, it, expect } from 'vitest';
import { SemrushPositionTrackingParser } from './semrushPositionTracking.parser';

describe('SemrushPositionTrackingParser', () => {
  const validRawContent = `-----
Project: example.com
Report type: position_tracking_pages
Date: 2024-01-15
-----

URL,Keywords,Average Position,Estimated Traffic
https://example.com/nursing,45,8.3,320
https://example.com/programs,30,12.1,180
https://example.com/about,10,22.5,45`;

  describe('matchesRawContent', () => {
    it('matches when content starts with ----- and contains position_tracking_pages', () => {
      expect(SemrushPositionTrackingParser.matchesRawContent(validRawContent)).toBe(true);
    });
    it('does not match regular CSV content', () => {
      const csv = 'Keyword,Position,URL\nnursing,5,https://example.com';
      expect(SemrushPositionTrackingParser.matchesRawContent(csv)).toBe(false);
    });
    it('does not match other SEMRush report types', () => {
      const other = `-----\nReport type: organic_research\n-----\nURL,Traffic`;
      expect(SemrushPositionTrackingParser.matchesRawContent(other)).toBe(false);
    });
  });

  describe('parse', () => {
    it('extracts position tracking data correctly', () => {
      const parser = new SemrushPositionTrackingParser(validRawContent);
      const result = parser.parse();
      expect(result.position_tracking_pages).toHaveLength(3);
      expect(result.position_tracking_pages[0]).toEqual({
        url: 'https://example.com/nursing',
        keyword_count: 45,
        average_position: 8.3,
        estimated_traffic: 320,
      });
    });

    it('returns empty array for metadata-only content', () => {
      const metaOnly = `-----\nProject: test\nReport type: position_tracking_pages\n-----\n\nURL,Keywords,Average Position,Estimated Traffic`;
      const parser = new SemrushPositionTrackingParser(metaOnly);
      const result = parser.parse();
      expect(result.position_tracking_pages).toHaveLength(0);
    });

    it('does not match non-position-tracking content via matchesRawContent', () => {
      expect(SemrushPositionTrackingParser.matchesRawContent('Keyword,Position,URL')).toBe(false);
    });
  });
});
