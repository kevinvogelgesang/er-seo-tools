import { describe, it, expect } from 'vitest';
import { canonicalizeCuratedIssues, CURATED_CANONICAL } from './curated-issue-dedup';
import type { Issue, IssuesResult } from '@/lib/types';

const iss = (type: string, severity: Issue['severity'] = 'warning', count = 1): Issue =>
  ({ type, severity, count, description: '' });

function group(all: Issue[]): IssuesResult {
  return {
    critical: all.filter((i) => i.severity === 'critical'),
    warnings: all.filter((i) => i.severity === 'warning'),
    notices: all.filter((i) => i.severity === 'notice'),
  };
}

describe('canonicalizeCuratedIssues', () => {
  it('keeps duplicate_title and drops duplicate_titles when both present', () => {
    const out = canonicalizeCuratedIssues(group([
      iss('duplicate_title', 'warning', 2),
      iss('duplicate_titles', 'warning', 2),
    ]));
    const types = [...out.critical, ...out.warnings, ...out.notices].map((i) => i.type);
    expect(types).toContain('duplicate_title');
    expect(types).not.toContain('duplicate_titles');
  });

  it('keeps duplicate_titles when it is the only duplicate-title signal', () => {
    const out = canonicalizeCuratedIssues(group([iss('duplicate_titles', 'warning', 3)]));
    const types = [...out.warnings].map((i) => i.type);
    expect(types).toContain('duplicate_titles');
  });

  it('never touches unrelated issues', () => {
    const out = canonicalizeCuratedIssues(group([
      iss('large_images'),
      iss('missing_alt_text'),
      iss('client_errors_4xx', 'critical'),
    ]));
    expect([...out.critical, ...out.warnings, ...out.notices]).toHaveLength(3);
  });

  it('every canonical group lists at least two non-sf_ types in preference order', () => {
    for (const order of CURATED_CANONICAL) {
      expect(order.length).toBeGreaterThanOrEqual(2);
      for (const t of order) expect(t.startsWith('sf_')).toBe(false);
    }
  });
});
