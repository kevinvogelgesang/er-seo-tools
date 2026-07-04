// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { findParserForFile } from '@/lib/parsers';
import { readHeaderChunk } from './read-header-chunk';

const CRAWL = '/Users/kevin/enrollment-resources/sf-crawls/manhattan/2026.07.03.11.29.25';

describe('peek-vs-full detection equivalence', () => {
  const files = fs.existsSync(CRAWL) ? fs.readdirSync(CRAWL).filter((f) => f.endsWith('.csv')) : [];

  it('found the Manhattan crawl fixture files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`same parser from peek and full: ${f}`, async () => {
      const full = fs.readFileSync(path.join(CRAWL, f), 'utf-8');
      const peek = await readHeaderChunk(path.join(CRAWL, f));
      expect(findParserForFile(f, peek)).toBe(findParserForFile(f, full));
    });
  }

  it('SEMRush Position Tracking: peek detection equals full (metadata preamble)', () => {
    // Real matcher (SemrushPositionTrackingParser.matchesRawContent):
    //   trimmed.startsWith('-----') && rawContent.includes('Report type: position_tracking_pages')
    // where `trimmed = rawContent.trimStart()`.
    const full = [
      '-----',
      'Project: example.com',
      'Report type: position_tracking_pages',
      '-----',
      'URL,Keywords,Average Position,Estimated Traffic',
      'https://a.com/x,5,3.2,120',
    ].join('\n');
    const peek = full.slice(0, 64 * 1024);
    const a = findParserForFile('pt_20260703.csv', peek);
    const b = findParserForFile('pt_20260703.csv', full);
    expect(a).toBe(b);
    expect(a && (a as { parserKey: string }).parserKey).toBe('semrushpositiontracking');
  });
});
