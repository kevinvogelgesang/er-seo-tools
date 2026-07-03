// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PDFParser } from './pdf.parser';

const large = 6 * 1024 * 1024, ok = 10 * 1024;   // threshold is 5MB
const MIXED = [
  'Address,Size (Bytes),Status Code',
  `https://ex.com/a.pdf,${large},200`,   // large
  `https://ex.com/b.pdf,${ok},404`,      // broken
  `https://ex.com/c.pdf,${ok},200`,      // clean
].join('\n');

describe('PDFParser golden', () => {
  it('large + broken + clean → exact output', () => {
    expect(new PDFParser(MIXED).parse()).toEqual({
      total_pdfs: 3,
      stats: {
        large_pdfs: 1,
        broken_pdfs: 1,
      },
      issues: [
        {
          type: 'large_pdfs',
          severity: 'notice',
          count: 1,
          description: '1 large PDFs (> 5MB)',
          urls: ['https://ex.com/a.pdf'],
        },
        {
          type: 'broken_pdfs',
          severity: 'warning',
          count: 1,
          description: '1 broken PDF links',
          urls: ['https://ex.com/b.pdf'],
        },
      ],
    });
  });
  it('only size column → stats has large_pdfs, no broken_pdfs', () => {
    const csv = `Address,Size (Bytes)\nhttps://ex.com/a.pdf,${large}`;
    expect(new PDFParser(csv).parse()).toEqual({
      total_pdfs: 1,
      stats: {
        large_pdfs: 1,
      },
      issues: [
        {
          type: 'large_pdfs',
          severity: 'notice',
          count: 1,
          description: '1 large PDFs (> 5MB)',
          urls: ['https://ex.com/a.pdf'],
        },
      ],
    });
  });
  it('only status column → stats has broken_pdfs, no large_pdfs', () => {
    const csv = 'Address,Status Code\nhttps://ex.com/a.pdf,500';
    expect(new PDFParser(csv).parse()).toEqual({
      total_pdfs: 1,
      stats: {
        broken_pdfs: 1,
      },
      issues: [
        {
          type: 'broken_pdfs',
          severity: 'warning',
          count: 1,
          description: '1 broken PDF links',
          urls: ['https://ex.com/a.pdf'],
        },
      ],
    });
  });
  it('neither size nor status → stats is {} but present, on a non-empty CSV', () => {
    const csv = 'Address\nhttps://ex.com/a.pdf';
    const out = new PDFParser(csv).parse() as { total_pdfs: number; stats: object; issues: unknown[] };
    expect(out).toEqual({ total_pdfs: 1, stats: {}, issues: [] });
  });
  it('empty CSV → {}', () => {
    expect(new PDFParser('Address,Size (Bytes),Status Code').parse()).toEqual({});
  });
});
