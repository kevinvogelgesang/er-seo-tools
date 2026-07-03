// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { JavaScriptParser } from './javascript.parser';

const large = 200 * 1024, ok = 10 * 1024;   // threshold is 100KB
const MIXED = [
  'Address,Size (Bytes),Status Code',
  `https://ex.com/a.js,${large},200`,   // large
  `https://ex.com/b.js,${ok},404`,      // broken
  `https://ex.com/c.js,${ok},200`,      // clean
].join('\n');

describe('JavaScriptParser golden', () => {
  it('large + broken + clean → exact output', () => {
    expect(new JavaScriptParser(MIXED).parse()).toEqual({
      total_js_files: 3,
      stats: {
        large_js_files: 1,
        broken_js: 1,
      },
      issues: [
        {
          type: 'large_js_files',
          severity: 'warning',
          count: 1,
          description: '1 large JavaScript files (> 100KB)',
          urls: ['https://ex.com/a.js'],
        },
        {
          type: 'broken_js',
          severity: 'critical',
          count: 1,
          description: '1 broken JavaScript files',
          urls: ['https://ex.com/b.js'],
        },
      ],
    });
  });
  it('only size column → stats has large_js_files, no broken_js', () => {
    const csv = `Address,Size (Bytes)\nhttps://ex.com/a.js,${large}`;
    expect(new JavaScriptParser(csv).parse()).toEqual({
      total_js_files: 1,
      stats: {
        large_js_files: 1,
      },
      issues: [
        {
          type: 'large_js_files',
          severity: 'warning',
          count: 1,
          description: '1 large JavaScript files (> 100KB)',
          urls: ['https://ex.com/a.js'],
        },
      ],
    });
  });
  it('only status column → stats has broken_js, no large_js_files', () => {
    const csv = 'Address,Status Code\nhttps://ex.com/a.js,500';
    expect(new JavaScriptParser(csv).parse()).toEqual({
      total_js_files: 1,
      stats: {
        broken_js: 1,
      },
      issues: [
        {
          type: 'broken_js',
          severity: 'critical',
          count: 1,
          description: '1 broken JavaScript files',
          urls: ['https://ex.com/a.js'],
        },
      ],
    });
  });
  it('neither size nor status → stats is {} but present, on a non-empty CSV', () => {
    const csv = 'Address\nhttps://ex.com/a.js';
    const out = new JavaScriptParser(csv).parse() as { total_js_files: number; stats: object; issues: unknown[] };
    expect(out).toEqual({ total_js_files: 1, stats: {}, issues: [] });
  });
  it('empty CSV → {}', () => {
    expect(new JavaScriptParser('Address,Size (Bytes),Status Code').parse()).toEqual({});
  });
});
