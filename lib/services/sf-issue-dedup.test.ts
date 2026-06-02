import { describe, it, expect } from 'vitest';
import { dropSupersededSfIssues, SF_SUPERSEDED_BY } from './sf-issue-dedup';
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

describe('dropSupersededSfIssues', () => {
  it('drops an sf_ issue when its curated equivalent is present', () => {
    const out = dropSupersededSfIssues(group([
      iss('sf_images_over_100_kb', 'notice', 9),
      iss('large_images', 'warning', 9),
    ]));
    const types = [...out.critical, ...out.warnings, ...out.notices].map((i) => i.type);
    expect(types).toContain('large_images');
    expect(types).not.toContain('sf_images_over_100_kb');
  });

  it('keeps the sf_ issue when its curated equivalent is ABSENT (overview-only upload)', () => {
    const out = dropSupersededSfIssues(group([iss('sf_images_over_100_kb', 'notice', 9)]));
    expect(out.notices.map((i) => i.type)).toContain('sf_images_over_100_kb');
  });

  it('keeps sf_ issues that have no curated equivalent (long tail)', () => {
    const out = dropSupersededSfIssues(group([
      iss('sf_security_missing_hsts_header', 'warning', 38),
      iss('sf_url_underscores', 'notice', 2),
      iss('client_errors_4xx', 'critical', 3),
    ]));
    const types = [...out.critical, ...out.warnings, ...out.notices].map((i) => i.type);
    expect(types).toContain('sf_security_missing_hsts_header');
    expect(types).toContain('sf_url_underscores');
  });

  it('dedupes across severities (curated in a different bucket than sf_)', () => {
    const out = dropSupersededSfIssues(group([
      iss('sf_directives_noindex', 'notice', 1),
      iss('noindex_pages', 'warning', 1),
    ]));
    const types = [...out.critical, ...out.warnings, ...out.notices].map((i) => i.type);
    expect(types).not.toContain('sf_directives_noindex');
    expect(types).toContain('noindex_pages');
  });

  it('never drops a non-sf_ (curated) issue', () => {
    const all = [iss('large_images'), iss('missing_alt_text'), iss('client_errors_4xx', 'critical')];
    const out = dropSupersededSfIssues(group(all));
    expect([...out.critical, ...out.warnings, ...out.notices]).toHaveLength(3);
  });

  it('every mapped curated target is a plausible issue type (sanity on the table)', () => {
    for (const [sf, targets] of Object.entries(SF_SUPERSEDED_BY)) {
      expect(sf.startsWith('sf_')).toBe(true);
      expect(Array.isArray(targets) && targets.length > 0).toBe(true);
      for (const t of targets) expect(t.startsWith('sf_')).toBe(false);
    }
  });
});
