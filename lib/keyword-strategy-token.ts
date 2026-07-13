// lib/keyword-strategy-token.ts — facade over lib/handoff (D1 consolidation,
// Task 6). Wire contract unchanged. Stateless JWT signing/verification for
// the KS-5 keyword strategy client export. Structural clone of
// lib/keyword-memo-token.ts — deliberately shares KEYWORD_MEMO_TOKEN_SECRET
// with that module (no new prod env var); the distinct AUDIENCE is what
// isolates the two token families from each other.
import type { JWTPayload } from 'jose';
import { createHandoffTokenFamily } from './handoff/token';
import { HANDOFF_TOKEN_CONFIGS } from './handoff/registry';

export { KeywordStrategyTokenError } from './handoff/errors';

export const KEYWORD_STRATEGY_TOKEN_SCOPES = HANDOFF_TOKEN_CONFIGS.kst.scopes;

export interface MintedToken {
  token: string;       // includes the 'kst_' prefix
  expiresAt: string;   // ISO 8601
}

const family = createHandoffTokenFamily(HANDOFF_TOKEN_CONFIGS.kst);

export async function mintKeywordStrategyToken(sessionId: string): Promise<MintedToken> {
  return family.mint(sessionId);
}

export async function verifyKeywordStrategyToken(
  token: string,
  expectedSessionId: string,
): Promise<JWTPayload> {
  return family.verify(token, expectedSessionId);
}
