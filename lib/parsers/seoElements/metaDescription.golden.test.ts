// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { MetaDescriptionParser } from './metaDescription.parser';

const CSV = [
  'Address,Meta Description 1,Meta Description 1 Length',
  'https://ex.com/a,' + 'A good meta description that clears seventy characters easily for sure yes indeed.'.slice(0,120) + ',95',
  'https://ex.com/b,,0',                                    // missing
  'https://ex.com/c,Too short meta,14',                     // short (<70,>0)
  'https://ex.com/d,' + 'y'.repeat(200) + ',200',           // long (>160)
  'https://ex.com/e,Dupe meta value,15',                    // dup + short
  'https://ex.com/f,Dupe meta value,15',                    // dup + short
].join('\n');

describe('MetaDescriptionParser golden', () => {
  it('produces exact current output for a mixed crawl', () => {
    const out = new MetaDescriptionParser(CSV).parse();
    expect(out).toEqual({
      total_pages: 6,
      excluded_urls: 0,
      issues: [
        {
          type: 'missing_meta_description',
          severity: 'warning',
          count: 1,
          description: '1 pages missing meta descriptions',
          urls: ['https://ex.com/b'],
        },
        {
          type: 'meta_description_too_short',
          severity: 'notice',
          count: 3,
          description: '3 pages with meta descriptions under 70 characters',
          threshold: '< 70 chars',
          urls: ['https://ex.com/c', 'https://ex.com/e', 'https://ex.com/f'],
        },
        {
          type: 'meta_description_too_long',
          severity: 'notice',
          count: 1,
          description: '1 pages with meta descriptions over 160 characters',
          threshold: '> 160 chars',
          urls: ['https://ex.com/d'],
        },
        {
          type: 'duplicate_meta_description',
          severity: 'notice',
          count: 1,
          description: '1 groups of pages with duplicate meta descriptions',
          groups: [
            {
              meta_description: 'Dupe meta value',
              count: 2,
              urls: ['https://ex.com/e', 'https://ex.com/f'],
            },
          ],
        },
      ],
    });
  });
});
