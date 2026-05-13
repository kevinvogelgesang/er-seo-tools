import { describe, expect, it } from 'vitest';
import { parseStoredResult } from './result-json';

describe('parseStoredResult', () => {
  it('returns parsed result objects', () => {
    const result = parseStoredResult('{"metadata":{"files_processed":[]}}');
    expect(result?.metadata.files_processed).toEqual([]);
  });

  it('returns null for corrupt stored JSON', () => {
    expect(parseStoredResult('{"metadata":')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(parseStoredResult('null')).toBeNull();
  });
});
