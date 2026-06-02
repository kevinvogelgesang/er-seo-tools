import { describe, it, expect } from 'vitest';
import { composeKeywordMemoPayload } from './keyword-memo-prompt';

describe('composeKeywordMemoPayload', () => {
  it('includes webapp, memo id, token, and the krt_ line', () => {
    const out = composeKeywordMemoPayload({ webappUrl: 'https://app.example', memoId: 'km_1', token: 'krt_abc' });
    expect(out).toContain('Webapp: https://app.example');
    expect(out).toContain('Memo ID: km_1');
    expect(out).toContain('Access token: krt_abc');
  });
});
