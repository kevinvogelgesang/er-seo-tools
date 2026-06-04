import { describe, it, expect } from 'vitest';
import {
  EXPECTED_EXPORTS,
  matchExpectedExports,
  missingCoreExports,
} from './expected-exports';

describe('expected-exports manifest', () => {
  it('marks internal_all and response_codes as the two core exports', () => {
    const core = EXPECTED_EXPORTS.filter((e) => e.tier === 'core').map((e) => e.id);
    expect(core).toContain('internal_all');
    expect(core).toContain('response_codes');
    expect(core).toHaveLength(2);
  });

  it('matches an uploaded internal_all.csv to the internal_all export (case-insensitive)', () => {
    const cov = matchExpectedExports(['Internal_All.csv', 'response_codes_all.csv']);
    const internal = cov.find((c) => c.export.id === 'internal_all');
    expect(internal?.present).toBe(true);
    expect(internal?.matchedFile).toBe('Internal_All.csv');
  });

  it('reports both core exports missing when only a non-core file is uploaded', () => {
    const missing = missingCoreExports(['images_missing_alt_text.csv']).map((e) => e.id);
    expect(missing).toContain('internal_all');
    expect(missing).toContain('response_codes');
  });

  it('reports no missing core when both core files are present', () => {
    expect(missingCoreExports(['internal_all.csv', 'response_codes_all.csv'])).toHaveLength(0);
  });

  it('every export has non-empty patterns and SF instructions (SEMRush flagged notExpectedFromSf)', () => {
    for (const e of EXPECTED_EXPORTS) {
      expect(e.filenamePatterns.length).toBeGreaterThan(0);
      if (e.notExpectedFromSf) continue;
      expect(e.sfInstructions.length).toBeGreaterThan(0);
    }
  });
});
