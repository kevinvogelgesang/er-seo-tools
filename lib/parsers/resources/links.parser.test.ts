import { describe, it, expect } from 'vitest';
import { LinksParser, LinksIssuesParser, ExternalLinksParser } from './links.parser';

describe('LinksParser (all_inlinks)', () => {
  describe('filenamePattern', () => {
    it('has the correct filenamePattern', () => {
      expect(LinksParser.filenamePattern).toBe('all_inlinks');
    });

    it('matchesFile returns true for matching filenames', () => {
      expect(LinksParser.matchesFile('all_inlinks.csv')).toBe(true);
      expect(LinksParser.matchesFile('bulk_export_all_inlinks.csv')).toBe(true);
    });

    it('matchesFile returns false for non-matching filenames', () => {
      expect(LinksParser.matchesFile('all_outlinks.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new LinksParser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for header-only CSV', () => {
      const csv = `Source,Destination,Status Code,Anchor\n`;
      const parser = new LinksParser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  describe('broken internal links', () => {
    it('reports broken links (4xx and 5xx status codes)', () => {
      const csv = `Source,Destination,Status Code,Anchor
https://example.com/,https://example.com/page1,200,Link One
https://example.com/,https://example.com/broken,404,Broken Link
https://example.com/about,https://example.com/error,500,Error Link
https://example.com/,https://example.com/redirect,301,Redirect`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'broken_internal_links');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('critical');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/broken');
      expect(issue.urls).toContain('https://example.com/error');
    });

    it('does not report broken links for 2xx and 3xx status codes', () => {
      const csv = `Source,Destination,Status Code,Anchor
https://example.com/,https://example.com/ok,200,Good Link
https://example.com/,https://example.com/redirect,301,Redirect Link`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'broken_internal_links');
      expect(issue).toBeUndefined();
    });

    it('includes 5xx server errors in broken links', () => {
      const csv = `Source,Destination,Status Code,Anchor
https://example.com/,https://example.com/server-error,503,Server Error`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'broken_internal_links');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(1);
    });
  });

  describe('empty anchor text', () => {
    it('reports links with empty anchor text', () => {
      const csv = `Source,Destination,Status Code,Anchor
https://example.com/,https://example.com/page1,200,Good Anchor Text
https://example.com/,https://example.com/page2,200,
https://example.com/,https://example.com/page3,200,`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'empty_anchor_text');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/page2');
      expect(issue.urls).toContain('https://example.com/page3');
    });

    it('does not report empty anchor text when all links have anchors', () => {
      const csv = `Source,Destination,Status Code,Anchor
https://example.com/,https://example.com/page1,200,Click Here
https://example.com/,https://example.com/page2,200,Read More`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'empty_anchor_text');
      expect(issue).toBeUndefined();
    });
  });

  describe('stats', () => {
    it('sets broken_internal_links stat correctly', () => {
      const csv = `Source,Destination,Status Code,Anchor
https://example.com/,https://example.com/broken,404,Broken`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      expect(result.stats.broken_internal_links).toBe(1);
    });

    it('sets empty_anchor_text stat correctly', () => {
      const csv = `Source,Destination,Status Code,Anchor
https://example.com/,https://example.com/page1,200,`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      expect(result.stats.empty_anchor_text).toBe(1);
    });
  });

  describe('total_links', () => {
    it('reports correct total link count', () => {
      const csv = `Source,Destination,Status Code,Anchor
https://example.com/,https://example.com/page1,200,Link 1
https://example.com/,https://example.com/page2,200,Link 2
https://example.com/,https://example.com/page3,200,Link 3`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      expect(result.total_links).toBe(3);
    });
  });

  describe('missing optional columns', () => {
    it('skips broken links check when Status Code column is absent', () => {
      const csv = `Source,Destination,Anchor
https://example.com/,https://example.com/page1,Good Link`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'broken_internal_links')).toBeUndefined();
    });

    it('skips empty anchor check when Anchor column is absent', () => {
      const csv = `Source,Destination,Status Code
https://example.com/,https://example.com/page1,200`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'empty_anchor_text')).toBeUndefined();
    });
  });

  describe('alternative column names', () => {
    it('accepts "From" as source column and "To" as destination column', () => {
      const csv = `From,To,Status Code,Anchor
https://example.com/,https://example.com/broken,404,Broken Link`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'broken_internal_links');
      expect(issue).toBeDefined();
      expect(issue.urls).toContain('https://example.com/broken');
    });

    it('accepts "Status" as status column', () => {
      const csv = `Source,Destination,Status,Anchor
https://example.com/,https://example.com/broken,404,Broken`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'broken_internal_links');
      expect(issue).toBeDefined();
    });
  });

  describe('url cap', () => {
    it('caps broken link URL list at 30', () => {
      const rows = Array.from({ length: 40 }, (_, i) =>
        `https://example.com/src,https://example.com/broken${i},404,Link ${i}`
      ).join('\n');
      const csv = `Source,Destination,Status Code,Anchor\n${rows}`;
      const parser = new LinksParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'broken_internal_links');
      expect(issue.count).toBe(40);
      expect(issue.urls.length).toBeLessThanOrEqual(30);
    });
  });
});

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
