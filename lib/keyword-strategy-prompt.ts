// lib/keyword-strategy-prompt.ts
// KS-5 §9 — clipboard prompt composer for the client-scoped keyword-strategy
// handoff. Mirrors composeKeywordMemoPayload (lib/keyword-memo-prompt.ts); the
// `kst_` prefix on the token is the skill's routing discriminator, and the
// human-readable "Strategy ID:" label is informational only.
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
  return [
    'Generate a keyword strategy document for this client.',
    '',
    `Webapp: ${webappUrl}`,
    `Strategy ID: ${strategyId}`,
    `Access token: ${token}`,
    '(Expires in 1h)',
    '',
    'Fetch the keyword strategy export, write the keyword strategy document, and post it back to the dashboard.',
  ].join('\n');
}
