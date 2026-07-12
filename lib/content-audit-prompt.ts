// lib/content-audit-prompt.ts
// C12 D1 — clipboard payload the ContentAuditCard copies. The er-handoff-memo
// skill's cat_ branch parses the "Content Audit ID:" + "Access token: cat_..."
// lines. Mirrors lib/keyword-strategy-prompt.ts.
export function buildContentAuditPrompt(opts: { siteAuditId: string; token: string; appUrl: string }): string {
  return [
    'Webapp: er-seo-tools',
    `Content Audit ID: ${opts.siteAuditId}`,
    `Access token: ${opts.token}`,
    `Base URL: ${opts.appUrl}`,
    '',
    'Run the er-handoff-memo skill: fetch the content-audit manifest, review the pages,',
    'and PATCH back cross-page consistency / stale-claim / quality findings.',
  ].join('\n')
}
