// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ResourceFileParser, type ResourceFileConfig } from './resource-file.base';

class Res extends ResourceFileParser {
  protected readonly config: ResourceFileConfig = {
    totalKey: 'total_x',
    large: { threshold: 1000, type: 'large_x', severity: 'notice', statKey: 'large_x', description: (n) => `${n} large` },
    broken: { type: 'broken_x', severity: 'warning', statKey: 'broken_x', description: (n) => `${n} broken` },
  };
}

describe('ResourceFileParser base', () => {
  it('neither column → stats {} present on non-empty CSV', () => {
    expect(new Res('Address\nhttps://ex.com/a').parse()).toEqual({ total_x: 1, stats: {}, issues: [] });
  });
  it('size only → large stat + issue, no broken key', () => {
    const out = new Res('Address,Size (Bytes)\nhttps://ex.com/a,5000').parse() as { stats: Record<string, number> };
    expect(out.stats).toEqual({ large_x: 1 });
  });
  it('status only → broken stat + issue, no large key', () => {
    const out = new Res('Address,Status Code\nhttps://ex.com/a,404').parse() as { stats: Record<string, number> };
    expect(out.stats).toEqual({ broken_x: 1 });
  });
});
