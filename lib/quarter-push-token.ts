// lib/quarter-push-token.ts — facade over lib/handoff (D1 consolidation,
// Task 6). Wire contract unchanged. Stateless JWT signing/verification for
// the quarter-cycle Teamwork push handoff (B5). Mirrors
// lib/seo-roadmap-token.ts (srt_) — same envelope, qct_ prefix.
import type { JWTPayload } from 'jose';
import { createHandoffTokenFamily } from './handoff/token';
import { HANDOFF_TOKEN_CONFIGS } from './handoff/registry';

export { QuarterPushTokenError } from './handoff/errors';

export interface MintedToken {
  token: string;       // includes the 'qct_' prefix
  expiresAt: string;   // ISO 8601
}

const family = createHandoffTokenFamily(HANDOFF_TOKEN_CONFIGS.qct);

export async function mintQuarterPushToken(planId: string): Promise<MintedToken> {
  return family.mint(planId);
}

export async function verifyQuarterPushToken(
  token: string,
  expectedPlanId: string,
): Promise<JWTPayload> {
  return family.verify(token, expectedPlanId);
}
