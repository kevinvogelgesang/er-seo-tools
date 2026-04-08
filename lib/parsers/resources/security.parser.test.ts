import { describe, it, expect } from 'vitest';
import { SecurityParser, InsecureContentParser } from './security.parser';

describe('SecurityParser', () => {
  describe('filenamePattern', () => {
    it('has the correct filenamePattern', () => {
      expect(SecurityParser.filenamePattern).toEqual(['security_all', 'security']);
    });

    it('matchesFile returns true for matching filenames', () => {
      expect(SecurityParser.matchesFile('security.csv')).toBe(true);
      expect(SecurityParser.matchesFile('resources_security_all.csv')).toBe(true);
    });

    it('matchesFile returns false for non-matching filenames', () => {
      expect(SecurityParser.matchesFile('links.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new SecurityParser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for header-only CSV', () => {
      const csv = `Address,HTTPS\n`;
      const parser = new SecurityParser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  describe('insecure pages via URL prefix', () => {
    it('detects pages served over HTTP by URL prefix', () => {
      const csv = `Address
http://example.com/insecure
http://example.com/another
https://example.com/secure`;
      const parser = new SecurityParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'insecure_pages');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('critical');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('http://example.com/insecure');
      expect(issue.urls).toContain('http://example.com/another');
      expect(issue.urls).not.toContain('https://example.com/secure');
    });

    it('does not report insecure_pages when all URLs are HTTPS', () => {
      const csv = `Address
https://example.com/
https://example.com/about
https://example.com/contact`;
      const parser = new SecurityParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'insecure_pages');
      expect(issue).toBeUndefined();
    });
  });

  describe('insecure pages via HTTPS column', () => {
    it('detects insecure pages when HTTPS column is "No"', () => {
      const csv = `Address,HTTPS
https://example.com/page1,Yes
https://example.com/page2,No
https://example.com/page3,No`;
      const parser = new SecurityParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'insecure_pages');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(2);
    });

    it('detects insecure pages when HTTPS column is "false"', () => {
      const csv = `Address,HTTPS
https://example.com/page1,true
https://example.com/page2,false`;
      const parser = new SecurityParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'insecure_pages');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(1);
    });

    it('is case-insensitive for HTTPS column values', () => {
      const csv = `Address,HTTPS
https://example.com/page1,YES
https://example.com/page2,NO`;
      const parser = new SecurityParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'insecure_pages');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(1);
    });

    it('reports no issues when all HTTPS values are "Yes"', () => {
      const csv = `Address,HTTPS
https://example.com/,Yes
https://example.com/about,Yes`;
      const parser = new SecurityParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'insecure_pages')).toBeUndefined();
    });
  });

  describe('stats', () => {
    it('sets insecure_pages stat correctly', () => {
      const csv = `Address
http://example.com/page1
https://example.com/page2`;
      const parser = new SecurityParser(csv);
      const result = parser.parse() as any;
      expect(result.stats.insecure_pages).toBe(1);
    });

    it('sets insecure_pages stat to 0 when all pages are secure', () => {
      const csv = `Address
https://example.com/
https://example.com/about`;
      const parser = new SecurityParser(csv);
      const result = parser.parse() as any;
      expect(result.stats.insecure_pages).toBe(0);
    });
  });

  describe('total_pages', () => {
    it('reports correct total page count', () => {
      const csv = `Address
https://example.com/
https://example.com/about
https://example.com/contact`;
      const parser = new SecurityParser(csv);
      const result = parser.parse() as any;
      expect(result.total_pages).toBe(3);
    });
  });

  describe('url cap on insecure list', () => {
    it('caps insecure URL list at 30 entries', () => {
      const rows = Array.from({ length: 40 }, (_, i) =>
        `http://example.com/page${i}`
      ).join('\n');
      const csv = `Address\n${rows}`;
      const parser = new SecurityParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'insecure_pages');
      expect(issue.count).toBe(40);
      expect(issue.urls.length).toBeLessThanOrEqual(30);
    });
  });
});

describe('InsecureContentParser', () => {
  describe('filenamePattern', () => {
    it('has the correct filenamePattern', () => {
      expect(InsecureContentParser.filenamePattern).toBe('insecure');
    });

    it('matchesFile returns true for matching filenames', () => {
      expect(InsecureContentParser.matchesFile('insecure.csv')).toBe(true);
      expect(InsecureContentParser.matchesFile('resources_insecure_content.csv')).toBe(true);
    });

    it('matchesFile returns false for non-matching filenames', () => {
      expect(InsecureContentParser.matchesFile('security.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new InsecureContentParser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for header-only CSV', () => {
      const csv = `Page,Resource\n`;
      const parser = new InsecureContentParser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  describe('mixed content detection', () => {
    it('reports mixed content pages with unique page count', () => {
      const csv = `Page,Resource
https://example.com/page1,http://cdn.example.com/image.jpg
https://example.com/page1,http://cdn.example.com/script.js
https://example.com/page2,http://cdn.example.com/style.css
https://example.com/page3,http://cdn.example.com/font.woff`;
      const parser = new InsecureContentParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'mixed_content');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      // 3 unique pages
      expect(issue.count).toBe(3);
      expect(issue.urls).toContain('https://example.com/page1');
      expect(issue.urls).toContain('https://example.com/page2');
      expect(issue.urls).toContain('https://example.com/page3');
    });

    it('deduplicates pages (same page with multiple insecure resources counts once)', () => {
      const csv = `Page,Resource
https://example.com/page1,http://cdn.example.com/image1.jpg
https://example.com/page1,http://cdn.example.com/image2.jpg
https://example.com/page1,http://cdn.example.com/image3.jpg`;
      const parser = new InsecureContentParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'mixed_content');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(1);
    });
  });

  describe('stats', () => {
    it('reports mixed_content_pages and insecure_resources stats', () => {
      const csv = `Page,Resource
https://example.com/page1,http://cdn.example.com/img1.jpg
https://example.com/page1,http://cdn.example.com/img2.jpg
https://example.com/page2,http://cdn.example.com/img3.jpg`;
      const parser = new InsecureContentParser(csv);
      const result = parser.parse() as any;
      expect(result.stats.mixed_content_pages).toBe(2);
      expect(result.stats.insecure_resources).toBe(3);
    });
  });

  describe('total_insecure_resources', () => {
    it('reports total row count as insecure resources', () => {
      const csv = `Page,Resource
https://example.com/page1,http://cdn.example.com/img1.jpg
https://example.com/page2,http://cdn.example.com/img2.jpg`;
      const parser = new InsecureContentParser(csv);
      const result = parser.parse() as any;
      expect(result.total_insecure_resources).toBe(2);
    });
  });

  describe('missing optional columns', () => {
    it('handles missing Page column gracefully', () => {
      const csv = `Resource
http://cdn.example.com/img1.jpg
http://cdn.example.com/img2.jpg`;
      const parser = new InsecureContentParser(csv);
      // Should not throw; unique page set will be empty because page values are empty
      expect(() => parser.parse()).not.toThrow();
    });
  });

  describe('url cap on mixed content list', () => {
    it('caps mixed content page URL list at 30', () => {
      const rows = Array.from({ length: 40 }, (_, i) =>
        `https://example.com/page${i},http://cdn.example.com/img${i}.jpg`
      ).join('\n');
      const csv = `Page,Resource\n${rows}`;
      const parser = new InsecureContentParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'mixed_content');
      expect(issue.count).toBe(40);
      expect(issue.urls.length).toBeLessThanOrEqual(30);
    });
  });
});
