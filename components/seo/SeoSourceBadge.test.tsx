// Node environment (no jsdom) — test the pure helper only.
import { describe, it, expect } from 'vitest';
import { seoSourceLabel } from './SeoSourceBadge';

describe('seoSourceLabel', () => {
  it('returns the caveat label for live-scan', () => {
    const label = seoSourceLabel('live-scan');
    expect(label).toMatch(/live scan/i);
    expect(label).toMatch(/on-page/i);
    expect(label.length).toBeGreaterThan(10);
  });

  it('returns "Screaming Frog" for sf-upload', () => {
    expect(seoSourceLabel('sf-upload')).toBe('Screaming Frog');
  });
});
