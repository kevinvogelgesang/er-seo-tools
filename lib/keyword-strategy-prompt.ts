// lib/keyword-strategy-prompt.ts
// KS-5 §9 — clipboard prompt composer for the client-scoped keyword-strategy
// handoff. Mirrors composeKeywordMemoPayload (lib/keyword-memo-prompt.ts); the
// `kst_` prefix on the token is the skill's routing discriminator, and the
// human-readable "Strategy ID:" label is informational only.
//
// Thin facade over lib/handoff/prompt.ts's composeHandoffPayload (D1
// consolidation) — byte-identical output, gated by
// lib/handoff/prompt-characterization.test.ts.
import { composeHandoffPayload } from './handoff/prompt';

export interface KeywordStrategyPromptArgs {
  webappUrl: string;
  strategyId: string;
  token: string;
}

export function composeKeywordStrategyPayload({
  webappUrl,
  strategyId,
  token,
}: KeywordStrategyPromptArgs): string {
  return composeHandoffPayload('kst', { webappUrl, id: strategyId, token });
}
