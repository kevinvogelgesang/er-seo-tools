// lib/quarter-push-prompt.ts
// Clipboard payload for the er-handoff-memo skill's qct_ (quarter push) flow.
// Mirrors lib/seo-roadmap-prompt.ts.
//
// Thin facade over lib/handoff/prompt.ts's composeHandoffPayload (D1
// consolidation) — byte-identical output, gated by
// lib/handoff/prompt-characterization.test.ts. planId is a number in this
// facade's signature (unchanged); composeHandoffPayload's `id` is a string,
// so it's stringified here (matches the original template literal's
// implicit ${planId} coercion).
import { composeHandoffPayload } from './handoff/prompt';

export function composeQuarterPushPayload({ webappUrl, planId, token }: { webappUrl: string; planId: number; token: string }): string {
  return composeHandoffPayload('qct', { webappUrl, id: String(planId), token });
}
