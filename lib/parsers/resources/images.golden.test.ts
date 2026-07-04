// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ImagesParser } from './images.parser';
import { parseString } from '../test-parse-helper';

const VERY_LARGE = 600 * 1024, LARGE = 200 * 1024, OK = 10 * 1024;
const CSV = [
  'Address,Alt Text,Size (Bytes),Status Code,Width,Height',
  `https://ex.com/a.png,Alt A,${OK},200,100,100`,       // clean
  `https://ex.com/b.png,,${LARGE},200,0,50`,            // missing alt, large, missing width
  `https://ex.com/c.png,Alt C,${VERY_LARGE},404,,`,     // very large, broken, missing dims
].join('\n');

describe('ImagesParser golden', () => {
  it('alt/size/status/dimension issues → exact output', () => {
    expect(parseString(ImagesParser, CSV)).toEqual({
      total_images: 3,
      stats: {
        missing_alt: 1,
        alt_coverage_percent: 66.7,
        images_with_alt: 2,
        large_images: 1,
        very_large_images: 1,
        broken_images: 1,
        missing_dimensions: 2,
      },
      issues: [
        { type: 'missing_alt_text', severity: 'warning', count: 1,
          description: '1 images missing alt text (66.7% coverage)', urls: ['https://ex.com/b.png'] },
        { type: 'very_large_images', severity: 'critical', count: 1,
          description: '1 very large images (> 500KB)', urls: ['https://ex.com/c.png'] },
        { type: 'large_images', severity: 'warning', count: 1,
          description: '1 large images (> 100KB)', urls: ['https://ex.com/b.png'] },
        { type: 'broken_images', severity: 'critical', count: 1,
          description: '1 broken images (4xx/5xx)', urls: ['https://ex.com/c.png'] },
        { type: 'images_missing_dimensions', severity: 'notice', count: 2,
          description: '2 images missing width/height attributes (layout shift risk)',
          urls: ['https://ex.com/b.png', 'https://ex.com/c.png'] },
      ],
    });
  });

  it('empty input → {}', () => {
    expect(parseString(ImagesParser, 'Address,Alt Text')).toEqual({});
  });
});
