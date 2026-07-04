// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readHeaderChunk } from './read-header-chunk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function tmp(content: string): Promise<string> {
  const p = path.join(os.tmpdir(), `peek-${Math.random().toString(36).slice(2)}.csv`);
  await fs.writeFile(p, content, 'utf-8');
  return p;
}

describe('readHeaderChunk', () => {
  it('returns the full content when smaller than the base size', async () => {
    const p = await tmp('Address,Title\nhttps://a.com/x,Hi');
    expect(await readHeaderChunk(p)).toBe('Address,Title\nhttps://a.com/x,Hi');
    await fs.rm(p, { force: true });
  });

  it('reads at least through the first newline', async () => {
    // base size tiny so we prove the newline-extension loop
    const p = await tmp('col1,col2,col3\nrow');
    const out = await readHeaderChunk(p, { baseChars: 4, maxChars: 1024 });
    expect(out.includes('\n')).toBe(true);
    expect(out.startsWith('col1,col2,col3')).toBe(true);
    await fs.rm(p, { force: true });
  });

  it('caps at maxChars when no newline appears', async () => {
    const p = await tmp('x'.repeat(5000)); // no newline
    const out = await readHeaderChunk(p, { baseChars: 64, maxChars: 1000 });
    expect(out.length).toBeLessThanOrEqual(1000);
    await fs.rm(p, { force: true });
  });
});
