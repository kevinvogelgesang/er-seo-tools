import { describe, expect, it } from 'vitest';
import { safeExternalHref } from './safe-external-href';

describe('safeExternalHref', () => {
  it('allows absolute http and https URLs', () => {
    expect(safeExternalHref('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    expect(safeExternalHref('http://example.com/')).toBe('http://example.com/');
  });

  it('rejects non-http schemes and relative URLs', () => {
    expect(safeExternalHref('javascript:alert(1)')).toBeNull();
    expect(safeExternalHref('data:text/html,hello')).toBeNull();
    expect(safeExternalHref('/relative/path')).toBeNull();
    expect(safeExternalHref('example.com')).toBeNull();
  });
});
