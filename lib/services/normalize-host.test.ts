import { describe, it, expect } from 'vitest';
import { normalizeHost } from './normalize-host';

describe('normalizeHost', () => {
  it('lowercases and strips leading www.', () => {
    expect(normalizeHost('WWW.Example.EDU')).toBe('example.edu');
    expect(normalizeHost('example.edu')).toBe('example.edu');
  });
  it('strips a scheme/path if a full URL sneaks in', () => {
    expect(normalizeHost('https://www.example.edu/a')).toBe('example.edu');
  });
  it('strips a path on scheme-less input', () => {
    expect(normalizeHost('www.example.edu/foo')).toBe('example.edu');
  });
  it('handles null/empty', () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost('')).toBeNull();
  });
  it('only strips a leading www., not embedded', () => {
    expect(normalizeHost('wwwx.example.edu')).toBe('wwwx.example.edu');
  });
});
