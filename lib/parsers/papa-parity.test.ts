// @vitest-environment node
import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { Readable } from 'node:stream';

const CFG = { header: true, skipEmptyLines: true, dynamicTyping: true } as const;

function whole(csv: string): unknown[] {
  return Papa.parse(csv, CFG).data as unknown[];
}
function streamed(csv: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const rows: unknown[] = [];
    const stream = Papa.parse(Papa.NODE_STREAM_INPUT, CFG);
    stream.on('data', (r) => rows.push(r));
    stream.on('end', () => resolve(rows));
    stream.on('error', reject);
    Readable.from([csv]).pipe(stream);
  });
}

const CASES: Record<string, string> = {
  crlf: 'Address,Title\r\nhttps://a.com/x,Hi\r\nhttps://a.com/y,Yo',
  trailingBlank: 'Address,Title\nhttps://a.com/x,Hi\n\n',
  noFinalNewline: 'Address,Title\nhttps://a.com/x,Hi',
  headerOnly: 'Address,Title',
  empty: '',
  extraColumns: 'Address,Title\nhttps://a.com/x,Hi,EXTRA,MORE',
  quotedNewline: 'Address,Title\nhttps://a.com/x,"line1\nline2"',
  dynamicTypes: 'A,B,C,D,E\n1,1.5,true,,"123"',
};

describe('Papa whole-file vs stream parity', () => {
  for (const [name, csv] of Object.entries(CASES)) {
    it(`identical rows: ${name}`, async () => {
      expect(await streamed(csv)).toEqual(whole(csv));
    });
  }

  // The one case where raw Papa entry points DIVERGE by design: the string
  // path calls stripBom(), the NODE_STREAM_INPUT path never does. streamCsv
  // compensates with its own BOM-stripping Transform so its rows stay
  // byte-identical to the whole-file path (proven in stream-csv.test.ts).
  it('documents the raw BOM asymmetry the driver compensates for', async () => {
    const bom = '﻿Address,Title\nhttps://a.com/x,Hello';
    expect(Object.keys(whole(bom)[0] as object)[0]).toBe('Address'); // string path strips BOM
    expect(Object.keys((await streamed(bom))[0] as object)[0]).toBe('﻿Address'); // raw stream path does not
  });
});
