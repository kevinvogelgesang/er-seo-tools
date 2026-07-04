// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { StreamingParser } from './streaming-parser.base';
import type { CSVRow } from '../types';
import type { ParsedData } from '../types';

class Probe extends StreamingParser {
  static parserKey = 'probe';
  static filenamePattern = 'probe_';
  onHeadersCalls = 0;
  headerSnapshot: string[] = [];
  rows: CSVRow[] = [];
  protected onHeaders(): void { this.onHeadersCalls++; this.headerSnapshot = [...this.headers]; }
  protected consumeRow(row: CSVRow): void { this.rows.push(row); }
  finalize(): ParsedData {
    if (this.isEmpty) return {};
    const addr = this.findColumn(['Address', 'URL']);
    return { total: this.length, addrCol: addr } as unknown as ParsedData;
  }
}

describe('StreamingParser', () => {
  it('onHeaders fires exactly once, before the first consumeRow, with headers resolved', () => {
    const p = new Probe();
    p.consume({ Address: 'https://a.com/x', Title: 'T1' });
    p.consume({ Address: 'https://a.com/y', Title: 'T2' });
    expect(p.onHeadersCalls).toBe(1);
    expect(p.headerSnapshot).toEqual(['Address', 'Title']);
    expect(p.rows).toHaveLength(2);
  });

  it('finalize on zero rows returns {} and onHeaders never fires', () => {
    const p = new Probe();
    expect(p.finalize()).toEqual({});
    expect(p.onHeadersCalls).toBe(0);
  });

  it('findColumn is case-insensitive after headers resolve', () => {
    const p = new Probe();
    p.consume({ URL: 'https://a.com/x' });
    expect(p.finalize()).toEqual({ total: 1, addrCol: 'URL' });
  });

  it('getPrimaryDomain returns the most common host from the Address/URL column', () => {
    const p = new Probe();
    p.consume({ Address: 'https://a.com/1' });
    p.consume({ Address: 'https://b.com/1' });
    p.consume({ Address: 'https://a.com/2' });
    expect(p.getPrimaryDomain()).toBe('a.com');
  });

  it('static matchesFile uses filenameMatches', () => {
    expect(Probe.matchesFile('probe_all.csv')).toBe(true);
    expect(Probe.matchesFile('other.csv')).toBe(false);
  });
});
