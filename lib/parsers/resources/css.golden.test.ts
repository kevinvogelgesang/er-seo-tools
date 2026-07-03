// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CSSParser } from './css.parser';
import { JavaScriptParser } from './javascript.parser';
import { PDFParser } from './pdf.parser';

const large = 200 * 1024, ok = 10 * 1024;   // threshold is 100KB
const MIXED = [
  'Address,Size (Bytes),Status Code',
  `https://ex.com/a.css,${large},200`,   // large
  `https://ex.com/b.css,${ok},404`,      // broken
  `https://ex.com/c.css,${ok},200`,      // clean
].join('\n');

describe('CSSParser golden', () => {
  it('large + broken + clean → exact output', () => {
    expect(new CSSParser(MIXED).parse()).toEqual({
      total_css_files: 3,
      stats: {
        large_css_files: 1,
        broken_css: 1,
      },
      issues: [
        {
          type: 'large_css_files',
          severity: 'notice',
          count: 1,
          description: '1 large CSS files (> 100KB)',
          urls: ['https://ex.com/a.css'],
        },
        {
          type: 'broken_css',
          severity: 'warning',
          count: 1,
          description: '1 broken CSS files',
          urls: ['https://ex.com/b.css'],
        },
      ],
    });
  });
  it('only size column → stats has large_css_files, no broken_css', () => {
    const csv = `Address,Size (Bytes)\nhttps://ex.com/a.css,${large}`;
    expect(new CSSParser(csv).parse()).toEqual({
      total_css_files: 1,
      stats: {
        large_css_files: 1,
      },
      issues: [
        {
          type: 'large_css_files',
          severity: 'notice',
          count: 1,
          description: '1 large CSS files (> 100KB)',
          urls: ['https://ex.com/a.css'],
        },
      ],
    });
  });
  it('only status column → stats has broken_css, no large_css_files', () => {
    const csv = 'Address,Status Code\nhttps://ex.com/a.css,500';
    expect(new CSSParser(csv).parse()).toEqual({
      total_css_files: 1,
      stats: {
        broken_css: 1,
      },
      issues: [
        {
          type: 'broken_css',
          severity: 'warning',
          count: 1,
          description: '1 broken CSS files',
          urls: ['https://ex.com/a.css'],
        },
      ],
    });
  });
  it('neither size nor status → stats is {} but present, on a non-empty CSV', () => {
    const csv = 'Address\nhttps://ex.com/a.css';
    const out = new CSSParser(csv).parse() as { total_css_files: number; stats: object; issues: unknown[] };
    expect(out).toEqual({ total_css_files: 1, stats: {}, issues: [] });
  });
  it('empty CSV → {}', () => {
    expect(new CSSParser('Address,Size (Bytes),Status Code').parse()).toEqual({});
  });

  it('top-level key insertion order is totalKey, stats, issues', () => {
    const out = new CSSParser('Address,Size (Bytes)\nhttps://ex.com/a.css,10').parse();
    expect(Object.keys(out)).toEqual(['total_css_files', 'stats', 'issues']);
  });

  it('stats key insertion order is large then broken when both columns present', () => {
    const out = new CSSParser('Address,Size (Bytes),Status Code\nhttps://ex.com/a.css,10,200').parse() as { stats: object };
    expect(Object.keys(out.stats)).toEqual(['large_css_files', 'broken_css']);
  });

  it('caps large URLs at 30', () => {
    const rows = Array.from({ length: 35 }, (_, i) => `https://ex.com/${i}.css,${200 * 1024}`).join('\n');
    const out = new CSSParser('Address,Size (Bytes)\n' + rows).parse() as { issues: { type: string; urls: string[] }[] };
    expect(out.issues.find(i => i.type === 'large_css_files')!.urls).toHaveLength(30);
  });

  it('resolves alternate columns (Size / File Size, Status)', () => {
    const out = new CSSParser('Address,File Size,Status\nhttps://ex.com/a.css,300000,404').parse() as { stats: Record<string, number> };
    expect(out.stats.large_css_files).toBe(1);
    expect(out.stats.broken_css).toBe(1);
  });

  it('static routing survives the refactor', () => {
    expect(CSSParser.matchesFile('internal_css.csv')).toBe(true);
    expect(JavaScriptParser.matchesFile('javascript_all.csv')).toBe(true);
    expect(PDFParser.matchesFile('some_pdf.csv')).toBe(true);
    expect((JavaScriptParser as unknown as { parserKey: string }).parserKey).toBe('javascript');
  });
});
