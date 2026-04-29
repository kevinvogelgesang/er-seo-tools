import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatAbsoluteTime } from './relative-time';

const NOW = new Date('2026-04-29T12:00:00Z');

describe('formatRelativeTime', () => {
  it('returns null for null input', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull();
  });

  it('returns "just now" for under 60 seconds', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 30_000), NOW)).toBe('just now');
  });

  it('returns "N minutes ago" for 1–59 minutes', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(new Date(NOW.getTime() - 1 * 60_000), NOW)).toBe('1 minute ago');
  });

  it('returns "N hours ago" for 1–23 hours', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 3 * 3600_000), NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(new Date(NOW.getTime() - 1 * 3600_000), NOW)).toBe('1 hour ago');
  });

  it('returns "N days ago" for 1–6 days', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 2 * 86_400_000), NOW)).toBe('2 days ago');
    expect(formatRelativeTime(new Date(NOW.getTime() - 1 * 86_400_000), NOW)).toBe('1 day ago');
  });

  it('returns absolute date for > 6 days', () => {
    // 10 days ago = 2026-04-19
    const old = new Date('2026-04-19T12:00:00Z');
    const result = formatRelativeTime(old, NOW);
    // Don't assert exact locale formatting; just assert it includes the year.
    expect(result).toMatch(/2026/);
  });

  it('handles future dates by returning "just now"', () => {
    // Future timestamps shouldn't crash; treat as "just now" (clock skew).
    expect(formatRelativeTime(new Date(NOW.getTime() + 30_000), NOW)).toBe('just now');
  });
});

describe('formatAbsoluteTime', () => {
  it('returns null for null input', () => {
    expect(formatAbsoluteTime(null)).toBeNull();
  });

  it('returns a non-empty localized string for a date', () => {
    const result = formatAbsoluteTime(new Date('2026-04-29T14:30:00Z'));
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    // Should contain the year for any reasonable locale.
    expect(result).toMatch(/2026/);
  });
});
