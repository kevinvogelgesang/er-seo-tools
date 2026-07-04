// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { streamCsv } from './stream-csv';
import type { CSVRow } from '../types';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function tmp(content: string): Promise<string> {
  const p = path.join(os.tmpdir(), `stream-csv-${Math.random().toString(36).slice(2)}.csv`);
  await fs.writeFile(p, content, 'utf-8');
  return p;
}

describe('streamCsv', () => {
  it('delivers each row then resolves', async () => {
    const p = await tmp('Address,Title\nhttps://a.com/x,Hi\nhttps://a.com/y,Yo');
    const rows: CSVRow[] = [];
    await streamCsv(p, (r) => rows.push(r));
    expect(rows).toEqual([
      { Address: 'https://a.com/x', Title: 'Hi' },
      { Address: 'https://a.com/y', Title: 'Yo' },
    ]);
    await fs.rm(p, { force: true });
  });

  it('rejects on a missing file', async () => {
    await expect(streamCsv('/no/such/file.csv', () => {})).rejects.toBeTruthy();
  });

  it('delivers ALL rows before resolving (no early finish, Codex High 2)', async () => {
    const N = 5000;
    const lines = ['Address,Title', ...Array.from({ length: N }, (_, i) => `https://a.com/${i},T${i}`)];
    const p = await tmp(lines.join('\n'));
    let count = 0;
    await streamCsv(p, () => { count++; });
    expect(count).toBe(N);
    await fs.rm(p, { force: true });
  });

  it('strips a leading BOM so the first header matches the whole-file path', async () => {
    const p = await tmp('﻿Address,Title\nhttps://a.com/x,Hi');
    const rows: CSVRow[] = [];
    await streamCsv(p, (r) => rows.push(r));
    expect(Object.keys(rows[0])[0]).toBe('Address');
    expect(rows).toEqual([{ Address: 'https://a.com/x', Title: 'Hi' }]);
    await fs.rm(p, { force: true });
  });
});
