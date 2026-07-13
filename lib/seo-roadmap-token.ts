// lib/seo-roadmap-token.ts — facade over lib/handoff (D1 consolidation, Task 6).
// Wire contract unchanged. Stateless JWT signing/verification for the SEO
// audit roadmap share feature.
import type { JWTPayload } from 'jose';
import { createHandoffTokenFamily } from './handoff/token';
import { HANDOFF_TOKEN_CONFIGS } from './handoff/registry';

export { SeoRoadmapTokenError } from './handoff/errors';

export interface MintedToken {
  token: string;       // includes the 'srt_' prefix
  expiresAt: string;   // ISO 8601
}

const family = createHandoffTokenFamily(HANDOFF_TOKEN_CONFIGS.srt);

export async function mintSeoRoadmapToken(roadmapId: string): Promise<MintedToken> {
  return family.mint(roadmapId);
}

export async function verifySeoRoadmapToken(
  token: string,
  expectedRoadmapId: string,
): Promise<JWTPayload> {
  return family.verify(token, expectedRoadmapId);
}
