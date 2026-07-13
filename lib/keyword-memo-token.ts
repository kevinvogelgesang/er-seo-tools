// lib/keyword-memo-token.ts — facade over lib/handoff (D1 consolidation, Task 6).
// Wire contract unchanged. Stateless JWT signing/verification for the
// keyword strategy memo share feature.
import type { JWTPayload } from 'jose';
import { createHandoffTokenFamily } from './handoff/token';
import { HANDOFF_TOKEN_CONFIGS } from './handoff/registry';

export { KeywordMemoTokenError } from './handoff/errors';

export interface MintedToken {
  token: string;       // includes the 'krt_' prefix
  expiresAt: string;   // ISO 8601
}

const family = createHandoffTokenFamily(HANDOFF_TOKEN_CONFIGS.krt);

export async function mintKeywordMemoToken(memoId: string): Promise<MintedToken> {
  return family.mint(memoId);
}

export async function verifyKeywordMemoToken(
  token: string,
  expectedMemoId: string,
): Promise<JWTPayload> {
  return family.verify(token, expectedMemoId);
}
