// lib/content-audit-prompt.ts
// C12 D1 — clipboard payload the ContentAuditCard copies. Mirrors
// lib/keyword-strategy-prompt.ts's composeKeywordStrategyPayload EXACTLY on the
// three lines the er-handoff-memo skill parses: `Webapp:` MUST be the dashboard
// URL (handoff.py uses it as --webapp, the API base), `Content Audit ID:` is the
// siteAuditId, and the `cat_` token prefix is the skill's routing discriminator.
//
// Thin facade over lib/handoff/prompt.ts's composeHandoffPayload (D1
// consolidation) — byte-identical output, gated by
// lib/handoff/prompt-characterization.test.ts. cat_'s two-sentence closer
// rides HANDOFF_META.cat.outroLine's embedded `\n` — `.join('\n')` produces
// the same bytes as the original two-element array tail.
import { composeHandoffPayload } from './handoff/prompt';

export function buildContentAuditPrompt(opts: { siteAuditId: string; token: string; appUrl: string }): string {
  return composeHandoffPayload('cat', { webappUrl: opts.appUrl, id: opts.siteAuditId, token: opts.token });
}
