// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildHeaderMap, findColumnInMap, mostCommonHostname, filenameMatches } from './header-map';

describe('header-map util', () => {
  it('buildHeaderMap sets original-case + lowercase keys; later duplicates overwrite', () => {
    const m = buildHeaderMap(['Address', 'ADDRESS']);
    expect(m.get('Address')).toBe('Address');
    // both 'address' (lowercased) entries collapse; last write wins
    expect(m.get('address')).toBe('ADDRESS');
    expect(m.get('ADDRESS')).toBe('ADDRESS');
  });

  it('findColumnInMap is case-insensitive, first-match wins', () => {
    const m = buildHeaderMap(['Status Code']);
    expect(findColumnInMap(m, ['Status Code', 'Status'])).toBe('Status Code');
    expect(findColumnInMap(m, ['status code'])).toBe('Status Code');
    expect(findColumnInMap(m, ['Nope'])).toBeNull();
  });

  it('mostCommonHostname returns the argmax host', () => {
    const c = new Map([['a.com', 1], ['b.com', 3]]);
    expect(mostCommonHostname(c)).toBe('b.com');
    expect(mostCommonHostname(new Map())).toBeNull();
  });

  it('filenameMatches: substring, array, case-insensitive, empty pattern false', () => {
    expect(filenameMatches('all_outlinks', 'all_outlinks.csv')).toBe(true);
    expect(filenameMatches(['images_all', 'images'], 'IMAGES.CSV')).toBe(true);
    expect(filenameMatches('', 'anything.csv')).toBe(false);
    expect(filenameMatches('links_', 'all_inlinks.csv')).toBe(false);
  });
});
