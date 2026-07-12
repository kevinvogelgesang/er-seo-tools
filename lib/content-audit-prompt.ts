// lib/content-audit-prompt.ts
// C12 D1 — clipboard payload the ContentAuditCard copies. Mirrors
// lib/keyword-strategy-prompt.ts's composeKeywordStrategyPayload EXACTLY on the
// three lines the er-handoff-memo skill parses: `Webapp:` MUST be the dashboard
// URL (handoff.py uses it as --webapp, the API base), `Content Audit ID:` is the
// siteAuditId, and the `cat_` token prefix is the skill's routing discriminator.
export function buildContentAuditPrompt(opts: { siteAuditId: string; token: string; appUrl: string }): string {
  return [
    "Run a content audit on this site audit's pages.",
    '',
    `Webapp: ${opts.appUrl}`,
    `Content Audit ID: ${opts.siteAuditId}`,
    `Access token: ${opts.token}`,
    '(Expires in 1h)',
    '',
    'Fetch the content-audit manifest, review the pages, and PATCH back',
    'cross-page consistency / stale-claim / quality findings.',
  ].join('\n')
}
