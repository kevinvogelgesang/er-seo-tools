// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LengthValidatorParser, type LengthValidatorConfig } from './length-validator.base';

class MissingOnly extends LengthValidatorParser {
  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['V'],
    missing: { type: 'missing_v', severity: 'notice', label: 'V values' },
  };
}

class DuplicateSlice extends LengthValidatorParser {
  protected readonly config: LengthValidatorConfig = {
    valueColumn: ['V'],
    missing: { type: 'missing_v', severity: 'notice', label: 'V values' },
    duplicate: {
      type: 'duplicate_v',
      severity: 'warning',
      label: 'V values',
      groupValueKey: 'title',
      groupValueSlice: 5,
    },
  };
}

describe('LengthValidatorParser base', () => {
  it('missing-only config emits just the missing issue, with total/excluded', () => {
    const out = new MissingOnly('Address,V\nhttps://ex.com/a,x\nhttps://ex.com/b,').parse() as { total_pages: number; excluded_urls: number; issues: { type: string }[] };
    expect(out.issues.map(i => i.type)).toEqual(['missing_v']);
    expect(out.total_pages).toBe(2);
    expect(out.excluded_urls).toBe(0);
  });
  it('returns {} on empty', () => {
    expect(new MissingOnly('Address,V').parse()).toEqual({});
  });
  it('duplicate group value is truncated to groupValueSlice', () => {
    const out = new DuplicateSlice('Address,V\nhttps://ex.com/a,ABCDEFGHIJ\nhttps://ex.com/b,ABCDEFGHIJ').parse() as {
      issues: { type: string; groups?: { title?: string }[] }[];
    };
    const dup = out.issues.find(i => i.type === 'duplicate_v');
    expect(dup?.groups?.[0]?.title).toBe('ABCDE');
  });
});
