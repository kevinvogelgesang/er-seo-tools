// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PageTitlesParser } from './pageTitles.parser';
import { H1Parser } from './h1.parser';
import { H2Parser } from './h2.parser';

const CSV = [
  'Address,Title 1,Title 1 Length,Title 2',
  'https://ex.com/a,Home Page Title That Is A Good Length Yes,42,',
  'https://ex.com/b,,0,',                                   // missing title
  'https://ex.com/c,Short,5,',                              // too short (<30, >0)
  'https://ex.com/d,' + 'x'.repeat(75) + ',75,',            // too long (>60)
  'https://ex.com/e,Dupe Title,10,',                        // dup group + short
  'https://ex.com/f,Dupe Title,10,Second Title Tag',        // dup + short + multiple
].join('\n');

describe('PageTitlesParser golden', () => {
  it('produces exact current output for a mixed crawl', () => {
    const out = new PageTitlesParser(CSV).parse();
    expect(out).toEqual({
      total_pages: 6,
      excluded_urls: 0,
      issues: [
        {
          type: 'missing_title',
          severity: 'critical',
          count: 1,
          description: '1 pages missing title tags',
          urls: ['https://ex.com/b'],
        },
        {
          type: 'title_too_short',
          severity: 'warning',
          count: 3,
          description: '3 pages with titles under 30 characters',
          threshold: '< 30 chars',
          urls: ['https://ex.com/c', 'https://ex.com/e', 'https://ex.com/f'],
        },
        {
          type: 'title_too_long',
          severity: 'notice',
          count: 1,
          description: '1 pages with titles over 60 characters',
          threshold: '> 60 chars',
          urls: ['https://ex.com/d'],
        },
        {
          type: 'duplicate_title',
          severity: 'warning',
          count: 1,
          description: '1 groups of pages with duplicate titles',
          groups: [
            {
              title: 'Dupe Title',
              count: 2,
              urls: ['https://ex.com/e', 'https://ex.com/f'],
            },
          ],
        },
        {
          type: 'multiple_titles',
          severity: 'warning',
          count: 1,
          description: '1 pages with multiple title tags',
          urls: ['https://ex.com/f'],
        },
      ],
    });
  });
});

it('does not count length 0 as too short', () => {
  const csv = 'Address,Title 1,Title 1 Length\nhttps://ex.com/a,,0';
  const out = new PageTitlesParser(csv).parse() as { issues: { type: string }[] };
  expect(out.issues.some(i => i.type === 'title_too_short')).toBe(false);
  expect(out.issues.some(i => i.type === 'missing_title')).toBe(true);
});

it('top-level key insertion order is total_pages, excluded_urls, issues', () => {
  const out = new PageTitlesParser('Address,Title 1\nhttps://ex.com/a,T').parse();
  expect(Object.keys(out)).toEqual(['total_pages', 'excluded_urls', 'issues']);
});

it('caps missing URLs at 20 and duplicate group URLs at 50', () => {
  const missingRows = Array.from({ length: 25 }, (_, i) => `https://ex.com/m${i},`).join('\n');
  const missOut = new PageTitlesParser('Address,Title 1\n' + missingRows).parse() as { issues: { type: string; urls: string[] }[] };
  expect(missOut.issues.find(i => i.type === 'missing_title')!.urls).toHaveLength(20);

  const dupRows = Array.from({ length: 60 }, (_, i) => `https://ex.com/d${i},Same Title`).join('\n');
  const dupOut = new PageTitlesParser('Address,Title 1\n' + dupRows).parse() as { issues: { type: string; groups: { urls: string[] }[] }[] };
  expect(dupOut.issues.find(i => i.type === 'duplicate_title')!.groups[0].urls).toHaveLength(50);
});

it('H1/H2 resolve the alternate value columns (H1 / H2, not just H1-1 / H2-1)', () => {
  const h1 = new H1Parser('Address,H1\nhttps://ex.com/a,\nhttps://ex.com/b,x').parse() as { issues: { type: string }[] };
  expect(h1.issues.some(i => i.type === 'missing_h1')).toBe(true);
  const h2 = new H2Parser('Address,H2\nhttps://ex.com/a,\nhttps://ex.com/b,x').parse() as { issues: { type: string }[] };
  expect(h2.issues.some(i => i.type === 'missing_h2')).toBe(true);
});

it('static routing survives the refactor (filenamePattern + matchesFile)', () => {
  expect(PageTitlesParser.matchesFile('page_titles_all.csv')).toBe(true);
  expect(H1Parser.matchesFile('h1_all.csv')).toBe(true);
  expect(H2Parser.matchesFile('h2_all.csv')).toBe(true);
  expect((PageTitlesParser as unknown as { parserKey: string }).parserKey).toBe('pagetitles');
});
