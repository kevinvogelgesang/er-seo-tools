// lib/quarter-push-prompt.ts
// Clipboard payload for the er-handoff-memo skill's qct_ (quarter push) flow.
// Mirrors lib/seo-roadmap-prompt.ts.

export function composeQuarterPushPayload({ webappUrl, planId, token }: { webappUrl: string; planId: number; token: string }): string {
  return [
    'Push the current quarter cycle to Teamwork.',
    '',
    `Webapp: ${webappUrl}`,
    `Plan ID: ${planId}`,
    `Access token: ${token}`,
    '(Expires in 1h)',
    '',
    "Fetch the cycle export, create the planned-week tasks in each client's Teamwork tasklist, and post the push receipt back to the dashboard.",
  ].join('\n')
}
