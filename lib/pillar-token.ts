// lib/pillar-token.ts — facade over lib/handoff (D1 consolidation, Task 6).
// Wire contract unchanged. Stateless JWT signing/verification for the
// pillar-analysis clipboard prompt.
// See docs/superpowers/specs/2026-04-29-pillar-analysis-phase-2-1-clipboard-prompt-design.md
import type { JWTPayload } from 'jose';
import { createHandoffTokenFamily } from './handoff/token';
import { HANDOFF_TOKEN_CONFIGS } from './handoff/registry';

export { PillarTokenError } from './handoff/errors';

export interface MintedToken {
  token: string;       // includes the 'pat_' prefix
  expiresAt: string;   // ISO 8601
}

const family = createHandoffTokenFamily(HANDOFF_TOKEN_CONFIGS.pat);

export async function mintPillarToken(analysisId: string): Promise<MintedToken> {
  return family.mint(analysisId);
}

export async function verifyPillarToken(
  token: string,
  expectedAnalysisId: string,
): Promise<JWTPayload> {
  return family.verify(token, expectedAnalysisId);
}
