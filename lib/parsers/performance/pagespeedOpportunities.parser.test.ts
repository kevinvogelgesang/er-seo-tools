import { describe, it, expect } from 'vitest';
import { PageSpeedOpportunitiesParser } from './pagespeedOpportunities.parser';

describe('PageSpeedOpportunitiesParser', () => {
  describe('filenamePattern', () => {
    it('matches pagespeed_opportunities_summary.csv', () => {
      expect(PageSpeedOpportunitiesParser.matchesFile('pagespeed_opportunities_summary.csv')).toBe(true);
    });
    it('does not match pagespeed_all.csv', () => {
      expect(PageSpeedOpportunitiesParser.matchesFile('pagespeed_all.csv')).toBe(false);
    });
  });

  describe('parse', () => {
    it('extracts opportunities and sorts by total_savings_ms descending', () => {
      const csv = `Opportunity,Number of URLs Affected,Total Savings ms,Average Savings ms,Total Savings Size Bytes,Average Savings Size Bytes
Eliminate render-blocking resources,5,3000,600,0,0
Reduce unused JavaScript,10,8000,800,250000,25000
Properly size images,3,1500,500,150000,50000`;
      const result = new PageSpeedOpportunitiesParser(csv).parse();
      expect(result.pagespeed_opportunities).toHaveLength(3);
      expect(result.pagespeed_opportunities[0].opportunity).toBe('Reduce unused JavaScript');
      expect(result.pagespeed_opportunities[0].total_savings_ms).toBe(8000);
      expect(result.pagespeed_opportunities[1].opportunity).toBe('Eliminate render-blocking resources');
    });

    it('filters rows where urls_affected is 0', () => {
      const csv = `Opportunity,Number of URLs Affected,Total Savings ms,Average Savings ms,Total Savings Size Bytes,Average Savings Size Bytes
Reduce unused JavaScript,0,8000,800,250000,25000
Properly size images,3,1500,500,150000,50000`;
      const result = new PageSpeedOpportunitiesParser(csv).parse();
      expect(result.pagespeed_opportunities).toHaveLength(1);
      expect(result.pagespeed_opportunities[0].opportunity).toBe('Properly size images');
    });

    it('does not include average_savings_size_bytes in output', () => {
      const csv = `Opportunity,Number of URLs Affected,Total Savings ms,Average Savings ms,Total Savings Size Bytes,Average Savings Size Bytes
Reduce unused JavaScript,5,8000,800,250000,25000`;
      const result = new PageSpeedOpportunitiesParser(csv).parse();
      expect(result.pagespeed_opportunities[0]).not.toHaveProperty('average_savings_size_bytes');
    });

    it('handles non-numeric values with 0 fallback', () => {
      const csv = `Opportunity,Number of URLs Affected,Total Savings ms,Average Savings ms,Total Savings Size Bytes,Average Savings Size Bytes
Reduce unused JavaScript,-,8000,800,250000,25000`;
      const result = new PageSpeedOpportunitiesParser(csv).parse();
      // urls_affected is 0 (NaN fallback), so row gets filtered out
      expect(result.pagespeed_opportunities).toHaveLength(0);
    });

    it('returns empty array for CSV with only headers', () => {
      const csv = `Opportunity,Number of URLs Affected,Total Savings ms,Average Savings ms,Total Savings Size Bytes,Average Savings Size Bytes`;
      const result = new PageSpeedOpportunitiesParser(csv).parse();
      expect(result.pagespeed_opportunities).toHaveLength(0);
    });
  });
});
