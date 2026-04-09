import { describe, it, expect } from 'vitest';
import { LinksIssuesParser, ExternalLinksParser } from './links.parser';

describe('LinksIssuesParser (links_)', () => {
  describe('filenamePattern', () => {
    it('has the correct filenamePattern', () => {
      expect(LinksIssuesParser.filenamePattern).toBe('links_');
    });

    it('matchesFile returns true for matching filenames', () => {
      expect(LinksIssuesParser.matchesFile('links_all.csv')).toBe(true);
      expect(LinksIssuesParser.matchesFile('issues_links_internal.csv')).toBe(true);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new LinksIssuesParser('');
      expect(parser.parse()).toEqual({});
    });
  });

  describe('normal data', () => {
    const csv = `Address,Crawl Depth,Inlinks
https://example.com/deep-page,5,2
https://example.com/another-deep,3,1`;

    it('always creates a links_quality_issue', () => {
      const parser = new LinksIssuesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'links_quality_issue');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(2);
    });

    it('tracks max crawl depth in stats', () => {
      const parser = new LinksIssuesParser(csv);
      const result = parser.parse() as any;
      expect(result.stats.max_crawl_depth).toBe(5);
    });

    it('includes URLs in issue', () => {
      const parser = new LinksIssuesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'links_quality_issue');
      expect(issue.urls).toContain('https://example.com/deep-page');
    });
  });

  describe('missing crawl depth column', () => {
    it('does not include stats when crawl depth column is absent', () => {
      const csv = `Address\nhttps://example.com/page`;
      const parser = new LinksIssuesParser(csv);
      const result = parser.parse() as any;
      expect(result.stats).toBeUndefined();
    });
  });
});

describe('ExternalLinksParser (all_outlinks)', () => {
  describe('filenamePattern', () => {
    it('has the correct filenamePattern', () => {
      expect(ExternalLinksParser.filenamePattern).toBe('all_outlinks');
    });

    it('matchesFile returns true for matching filenames', () => {
      expect(ExternalLinksParser.matchesFile('all_outlinks.csv')).toBe(true);
    });

    it('matchesFile returns false for inlinks', () => {
      expect(ExternalLinksParser.matchesFile('all_inlinks.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new ExternalLinksParser('');
      expect(parser.parse()).toEqual({});
    });
  });

  describe('broken external links', () => {
    it('reports broken external links (4xx and 5xx)', () => {
      const csv = `Source,Destination,Status Code
https://example.com/,https://external.com/ok,200
https://example.com/,https://external.com/broken,404
https://example.com/,https://external.com/server,500`;
      const parser = new ExternalLinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'broken_external_links');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://external.com/broken');
      expect(issue.urls).toContain('https://external.com/server');
    });

    it('does not report broken external links for valid responses', () => {
      const csv = `Source,Destination,Status Code
https://example.com/,https://external.com/page,200
https://example.com/,https://external.com/moved,301`;
      const parser = new ExternalLinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'broken_external_links');
      expect(issue).toBeUndefined();
    });
  });

  describe('total_external_links', () => {
    it('reports correct total count', () => {
      const csv = `Source,Destination,Status Code
https://example.com/,https://ext1.com/,200
https://example.com/,https://ext2.com/,200`;
      const parser = new ExternalLinksParser(csv);
      const result = parser.parse() as any;
      expect(result.total_external_links).toBe(2);
    });
  });
});
