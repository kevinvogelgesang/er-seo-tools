import { describe, it, expect } from 'vitest';
import { composeKeywordStrategyPayload } from './keyword-strategy-prompt';

describe('composeKeywordStrategyPayload', () => {
  it('emits the exact strategy prompt lines', () => {
    const payload = composeKeywordStrategyPayload({
      webappUrl: 'https://tools.example.com',
      strategyId: 'abc123',
      token: 'kst_deadbeef',
    });
    expect(payload).toBe(
      [
        'Generate a keyword strategy document for this client.',
        '',
        'Webapp: https://tools.example.com',
        'Strategy ID: abc123',
        'Access token: kst_deadbeef',
        '(Expires in 1h)',
        '',
        'Fetch the keyword strategy export, write the keyword strategy document, and post it back to the dashboard.',
      ].join('\n'),
    );
  });

  it('includes the Strategy ID label and the kst_ token verbatim', () => {
    const payload = composeKeywordStrategyPayload({
      webappUrl: 'https://x',
      strategyId: 'sid',
      token: 'kst_abc',
    });
    expect(payload).toContain('Strategy ID: sid');
    expect(payload).toContain('Access token: kst_abc');
  });
});
