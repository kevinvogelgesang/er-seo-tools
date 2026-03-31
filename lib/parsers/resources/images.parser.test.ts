import { describe, it, expect } from 'vitest';
import { ImagesParser } from './images.parser';

describe('ImagesParser', () => {
  describe('static properties', () => {
    it('has filenamePattern of "images"', () => {
      expect(ImagesParser.filenamePattern).toBe('images');
    });

    it('matchesFile returns true for filenames containing "images"', () => {
      expect(ImagesParser.matchesFile('images.csv')).toBe(true);
      expect(ImagesParser.matchesFile('all_images_export.csv')).toBe(true);
      expect(ImagesParser.matchesFile('IMAGES.CSV')).toBe(true);
    });

    it('matchesFile returns false for unrelated filenames', () => {
      expect(ImagesParser.matchesFile('pagespeed.csv')).toBe(false);
      expect(ImagesParser.matchesFile('h1.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new ImagesParser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for headers-only CSV', () => {
      const csv = `Address,Alt Text,Size (Bytes),Status Code,Width,Height`;
      const parser = new ImagesParser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  describe('missing alt text', () => {
    it('detects images with missing alt text', () => {
      const csv = `Address,Alt Text
https://example.com/img1.jpg,
https://example.com/img2.jpg,Some alt text
https://example.com/img3.jpg,`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      expect(result.total_images).toBe(3);
      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_alt_text');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/img1.jpg');
      expect(issue.urls).toContain('https://example.com/img3.jpg');
      expect(issue.urls).not.toContain('https://example.com/img2.jpg');
    });

    it('sets severity to "warning" when alt coverage < 80%', () => {
      // 1 of 5 has alt = 20% coverage < 80%
      const csv = `Address,Alt Text
https://example.com/img1.jpg,Good alt
https://example.com/img2.jpg,
https://example.com/img3.jpg,
https://example.com/img4.jpg,
https://example.com/img5.jpg,`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_alt_text');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
    });

    it('sets severity to "notice" when alt coverage >= 80%', () => {
      // 4 of 5 have alt = 80% coverage
      const csv = `Address,Alt Text
https://example.com/img1.jpg,Good alt
https://example.com/img2.jpg,Good alt
https://example.com/img3.jpg,Good alt
https://example.com/img4.jpg,Good alt
https://example.com/img5.jpg,`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_alt_text');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
    });

    it('records images_with_alt stat', () => {
      const csv = `Address,Alt Text
https://example.com/img1.jpg,Descriptive text
https://example.com/img2.jpg,Another description
https://example.com/img3.jpg,`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      expect(result.stats.images_with_alt).toBe(2);
      expect(result.stats.missing_alt).toBe(1);
    });

    it('does not push missing_alt_text issue when all images have alt text', () => {
      const csv = `Address,Alt Text
https://example.com/img1.jpg,Alt 1
https://example.com/img2.jpg,Alt 2`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_alt_text');
      expect(issue).toBeUndefined();
      expect(result.stats.images_with_alt).toBe(2);
      expect(result.stats.missing_alt).toBe(0);
    });

    it('skips alt text check when Alt Text column is absent', () => {
      const csv = `Address,Size (Bytes)
https://example.com/img1.jpg,50000`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_alt_text');
      expect(issue).toBeUndefined();
      expect(result.stats.missing_alt).toBeUndefined();
    });
  });

  describe('image size issues', () => {
    it('detects very large images (> 500KB) as critical', () => {
      const VERY_LARGE = 500 * 1024 + 1; // 512001 bytes
      const csv = `Address,Size (Bytes)
https://example.com/huge.jpg,${VERY_LARGE}
https://example.com/small.jpg,10000`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'very_large_images');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('critical');
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/huge.jpg');
    });

    it('detects large images (> 100KB, <= 500KB) as warning', () => {
      const LARGE = 200 * 1024; // 204800 bytes
      const csv = `Address,Size (Bytes)
https://example.com/large.jpg,${LARGE}
https://example.com/small.jpg,10000`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'large_images');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/large.jpg');
    });

    it('does not flag large_images for very large images (they go in very_large_images)', () => {
      const VERY_LARGE = 600 * 1024;
      const csv = `Address,Size (Bytes)
https://example.com/huge.jpg,${VERY_LARGE}`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const veryLargeIssue = result.issues.find((i: { type: string }) => i.type === 'very_large_images');
      const largeIssue = result.issues.find((i: { type: string }) => i.type === 'large_images');
      expect(veryLargeIssue).toBeDefined();
      expect(largeIssue).toBeUndefined();
    });

    it('records size stats when Size column present', () => {
      const csv = `Address,Size (Bytes)
https://example.com/a.jpg,${600 * 1024}
https://example.com/b.jpg,${200 * 1024}
https://example.com/c.jpg,50000`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      expect(result.stats.very_large_images).toBe(1);
      expect(result.stats.large_images).toBe(1);
    });

    it('skips size check when Size column is absent', () => {
      const csv = `Address,Alt Text
https://example.com/img1.jpg,Alt text`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      expect(result.stats.large_images).toBeUndefined();
      expect(result.stats.very_large_images).toBeUndefined();
    });
  });

  describe('broken images', () => {
    it('detects broken images (4xx/5xx status codes) as critical', () => {
      const csv = `Address,Status Code
https://example.com/missing.jpg,404
https://example.com/error.jpg,500
https://example.com/ok.jpg,200`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'broken_images');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('critical');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/missing.jpg');
      expect(issue.urls).toContain('https://example.com/error.jpg');
      expect(issue.urls).not.toContain('https://example.com/ok.jpg');
    });

    it('does not flag 3xx redirects as broken', () => {
      const csv = `Address,Status Code
https://example.com/redirect.jpg,301
https://example.com/ok.jpg,200`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'broken_images');
      expect(issue).toBeUndefined();
    });

    it('records broken_images stat', () => {
      const csv = `Address,Status Code
https://example.com/missing.jpg,404`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      expect(result.stats.broken_images).toBe(1);
    });
  });

  describe('missing dimensions', () => {
    it('detects images missing width or height attributes', () => {
      const csv = `Address,Width,Height
https://example.com/nodims.jpg,,
https://example.com/nowidth.jpg,,100
https://example.com/good.jpg,200,150`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'images_missing_dimensions');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/nodims.jpg');
      expect(issue.urls).toContain('https://example.com/nowidth.jpg');
      expect(issue.urls).not.toContain('https://example.com/good.jpg');
    });

    it('treats dimension value "0" as missing', () => {
      const csv = `Address,Width,Height
https://example.com/zero.jpg,0,0`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'images_missing_dimensions');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(1);
    });

    it('skips dimension check when no Width or Height column present', () => {
      const csv = `Address,Alt Text
https://example.com/img.jpg,Some alt`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'images_missing_dimensions');
      expect(issue).toBeUndefined();
      expect(result.stats.missing_dimensions).toBeUndefined();
    });
  });

  describe('threshold boundaries', () => {
    const LARGE = 100 * 1024;       // 102400 bytes
    const VERY_LARGE = 500 * 1024;  // 512000 bytes

    // ── LARGE_IMAGE_SIZE = 100KB (102400 bytes) ───────────────────────────────
    // Condition: size > LARGE_IMAGE_SIZE → large; size <= LARGE_IMAGE_SIZE → not large
    it('image of exactly 102400 bytes (100KB) is NOT flagged as large', () => {
      const csv = `Address,Size (Bytes)\nhttps://example.com/exact.jpg,${LARGE}`;
      const result = new ImagesParser(csv).parse();
      const issue = result.issues.find((i: { type: string }) => i.type === 'large_images');
      expect(issue).toBeUndefined();
    });

    it('image of exactly 102401 bytes (1 byte over 100KB) IS flagged as large', () => {
      const csv = `Address,Size (Bytes)\nhttps://example.com/over.jpg,${LARGE + 1}`;
      const result = new ImagesParser(csv).parse();
      const issue = result.issues.find((i: { type: string }) => i.type === 'large_images');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(1);
    });

    it('image of exactly 102399 bytes (1 byte under 100KB) is NOT flagged', () => {
      const csv = `Address,Size (Bytes)\nhttps://example.com/under.jpg,${LARGE - 1}`;
      const result = new ImagesParser(csv).parse();
      const largeIssue = result.issues.find((i: { type: string }) => i.type === 'large_images');
      const veryLargeIssue = result.issues.find((i: { type: string }) => i.type === 'very_large_images');
      expect(largeIssue).toBeUndefined();
      expect(veryLargeIssue).toBeUndefined();
    });

    // ── VERY_LARGE_IMAGE_SIZE = 500KB (512000 bytes) ──────────────────────────
    // Condition: size > VERY_LARGE → very_large; size <= VERY_LARGE and size > LARGE → large
    it('image of exactly 512000 bytes (500KB) is flagged as large (not very_large)', () => {
      const csv = `Address,Size (Bytes)\nhttps://example.com/exact-vl.jpg,${VERY_LARGE}`;
      const result = new ImagesParser(csv).parse();
      const veryLargeIssue = result.issues.find((i: { type: string }) => i.type === 'very_large_images');
      const largeIssue = result.issues.find((i: { type: string }) => i.type === 'large_images');
      expect(veryLargeIssue).toBeUndefined();
      expect(largeIssue).toBeDefined();
      expect(largeIssue.severity).toBe('warning');
    });

    it('image of exactly 512001 bytes (1 byte over 500KB) IS flagged as very_large', () => {
      const csv = `Address,Size (Bytes)\nhttps://example.com/over-vl.jpg,${VERY_LARGE + 1}`;
      const result = new ImagesParser(csv).parse();
      const issue = result.issues.find((i: { type: string }) => i.type === 'very_large_images');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('critical');
      expect(issue.count).toBe(1);
      // must NOT also appear in large_images
      const largeIssue = result.issues.find((i: { type: string }) => i.type === 'large_images');
      expect(largeIssue).toBeUndefined();
    });

    it('image of exactly 511999 bytes (1 byte under 500KB) is flagged as large only', () => {
      const csv = `Address,Size (Bytes)\nhttps://example.com/under-vl.jpg,${VERY_LARGE - 1}`;
      const result = new ImagesParser(csv).parse();
      const veryLargeIssue = result.issues.find((i: { type: string }) => i.type === 'very_large_images');
      const largeIssue = result.issues.find((i: { type: string }) => i.type === 'large_images');
      expect(veryLargeIssue).toBeUndefined();
      expect(largeIssue).toBeDefined();
    });

    // ── Alt coverage boundary: 80% ─────────────────────────────────────────────
    // Condition: altCoveragePercent < 80 → warning; >= 80 → notice
    // Use 10 images: 8 with alt = 80% → notice; 7 with alt + 3 missing = 70% → warning
    it('alt coverage of exactly 80% (8/10) produces severity "notice"', () => {
      const rows = [
        'https://example.com/1.jpg,Alt 1',
        'https://example.com/2.jpg,Alt 2',
        'https://example.com/3.jpg,Alt 3',
        'https://example.com/4.jpg,Alt 4',
        'https://example.com/5.jpg,Alt 5',
        'https://example.com/6.jpg,Alt 6',
        'https://example.com/7.jpg,Alt 7',
        'https://example.com/8.jpg,Alt 8',
        'https://example.com/9.jpg,',
        'https://example.com/10.jpg,',
      ].join('\n');
      const csv = `Address,Alt Text\n${rows}`;
      const result = new ImagesParser(csv).parse();
      // 8/10 = 80%
      expect(result.stats.alt_coverage_percent).toBe(80);
      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_alt_text');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
    });

    it('alt coverage of exactly 79% (79/100) produces severity "warning"', () => {
      // Build 100 rows: 79 with alt, 21 missing
      const withAlt = Array.from({ length: 79 }, (_, i) => `https://example.com/img${i + 1}.jpg,Alt`);
      const withoutAlt = Array.from({ length: 21 }, (_, i) => `https://example.com/missing${i + 1}.jpg,`);
      const csv = `Address,Alt Text\n${[...withAlt, ...withoutAlt].join('\n')}`;
      const result = new ImagesParser(csv).parse();
      expect(result.stats.alt_coverage_percent).toBe(79);
      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_alt_text');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
    });
  });

  describe('mixed issues', () => {
    it('handles all issues together in one parse', () => {
      const VERY_LARGE = 600 * 1024;
      const LARGE = 200 * 1024;
      const csv = `Address,Alt Text,Size (Bytes),Status Code,Width,Height
https://example.com/a.jpg,,${VERY_LARGE},200,0,0
https://example.com/b.jpg,,${LARGE},404,300,200
https://example.com/c.jpg,Good alt,50000,200,100,80
https://example.com/d.jpg,,50000,500,,`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      expect(result.total_images).toBe(4);
      expect(result.issues.find((i: { type: string }) => i.type === 'missing_alt_text')).toBeDefined();
      expect(result.issues.find((i: { type: string }) => i.type === 'very_large_images')).toBeDefined();
      expect(result.issues.find((i: { type: string }) => i.type === 'large_images')).toBeDefined();
      expect(result.issues.find((i: { type: string }) => i.type === 'broken_images')).toBeDefined();
      expect(result.issues.find((i: { type: string }) => i.type === 'images_missing_dimensions')).toBeDefined();
    });

    it('returns no issues when all images are healthy', () => {
      const csv = `Address,Alt Text,Size (Bytes),Status Code,Width,Height
https://example.com/a.jpg,Alt A,50000,200,100,80
https://example.com/b.jpg,Alt B,80000,200,200,150`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      expect(result.issues).toHaveLength(0);
    });
  });

  describe('alt coverage percent calculation', () => {
    it('computes alt_coverage_percent correctly', () => {
      const csv = `Address,Alt Text
https://example.com/a.jpg,Alt
https://example.com/b.jpg,Alt
https://example.com/c.jpg,Alt
https://example.com/d.jpg,`;

      const parser = new ImagesParser(csv);
      const result = parser.parse();

      // 3/4 = 75%
      expect(result.stats.alt_coverage_percent).toBe(75);
    });
  });
});
