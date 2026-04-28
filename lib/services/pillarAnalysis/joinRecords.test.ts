import { describe, it, expect } from 'vitest';
import { joinUrlRecords, type RawUrlData } from './joinRecords';

describe('joinUrlRecords', () => {
  it('joins all signals on URL and applies page-type + intent classification', () => {
    const internalRows: RawUrlData[] = [
      {
        url: 'https://e.edu/blog/become-rn',
        title: 'How to Become an RN',
        h1: 'How to Become an RN',
        metaDescription: 'A guide to nursing licensure.',
        firstParagraph: 'Becoming a registered nurse takes time and study.',
        wordCount: 1200,
        crawlDepth: 3,
        inlinks: 4,
        outlinks: 8,
        indexable: true,
        schemaTypes: ['BlogPosting'],
      },
      {
        url: 'https://e.edu/programs/bsn',
        title: 'BSN Program',
        h1: 'Bachelor of Science in Nursing',
        metaDescription: null,
        firstParagraph: null,
        wordCount: 800,
        crawlDepth: 1,
        inlinks: 25,
        outlinks: 12,
        indexable: true,
        schemaTypes: ['EducationalOccupationalProgram'],
      },
    ];
    const gsc = new Map([
      ['https://e.edu/blog/become-rn', { clicks: 50, impressions: 1200, ctr: 0.04, position: 8.2 }],
    ]);
    const ga4 = new Map();
    const semrush = new Map();

    const records = joinUrlRecords({ internalRows, gsc, ga4, semrush });

    expect(records).toHaveLength(2);

    const blog = records.find(r => r.url.endsWith('/become-rn'))!;
    expect(blog.pageType).toBe('blog');
    expect(blog.intentClass).toBe('informational');
    expect(blog.gscClicks).toBe(50);
    expect(blog.gscImpressions).toBe(1200);
    expect(blog.ga4Sessions).toBeNull();
    expect(blog.referringDomains).toBeNull();

    const program = records.find(r => r.url.endsWith('/bsn'))!;
    expect(program.pageType).toBe('program');
    expect(program.intentClass).toBe('transactional');
  });

  it('preserves URLs not present in optional sources', () => {
    const internalRows: RawUrlData[] = [{
      url: 'https://e.edu/blog/x',
      title: 'X', h1: 'X', metaDescription: null, firstParagraph: null,
      wordCount: 500, crawlDepth: 3, inlinks: 1, outlinks: 1, indexable: true,
      schemaTypes: [],
    }];
    const records = joinUrlRecords({
      internalRows, gsc: new Map(), ga4: new Map(), semrush: new Map(),
    });
    expect(records).toHaveLength(1);
    expect(records[0].gscClicks).toBeNull();
  });
});
