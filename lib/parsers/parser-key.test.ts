import { describe, it, expect } from 'vitest';
import { PARSERS } from './index';
import type { ParserClass } from './header-map';

// Guards the production-only minification bug: the parse route used to derive
// the parsedData key from ParserClass.name, which the SWC build mangles to
// single letters in production — so the aggregator's hardcoded
// `this.parsedData.internal` (etc.) lookups missed and page_index/keyword data
// came out empty. Each parser must declare an OWN static `parserKey` string
// literal (survives minification); the route uses that, not the class name.
describe('parser keys are explicit + minification-proof', () => {
  it('every registered parser declares its OWN static parserKey', () => {
    for (const P of PARSERS) {
      expect(
        Object.prototype.hasOwnProperty.call(P, 'parserKey'),
        `${P.name} must declare a static parserKey (string literal — class names are minified in prod)`,
      ).toBe(true);
      expect(typeof (P as ParserClass).parserKey).toBe('string');
      expect(((P as ParserClass).parserKey ?? '').length).toBeGreaterThan(0);
    }
  });

  it('parserKey equals the canonical aggregator key (the un-minified name-derivation)', () => {
    for (const P of PARSERS) {
      const canonical = P.name.replace('Parser', '').toLowerCase();
      expect((P as ParserClass).parserKey).toBe(canonical);
    }
  });

  it('parser keys are unique across the registry', () => {
    const keys = PARSERS.map((p) => (p as ParserClass).parserKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
