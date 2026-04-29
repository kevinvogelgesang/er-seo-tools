// lib/pillar-prompt.ts
// Canonical composer + parser for the pillar-analysis clipboard prompt.
// Used by the dashboard's CopyClaudePromptButton (compose) and by the
// regression test (parse). The skill (Phase 2.2) documents the same
// regex pattern in its SKILL.md — see docs/pillar-prompt-contract.md
// for the single source of truth.

export interface PillarPromptArgs {
  webappUrl: string;
  analysisId: string;
  token: string;
}

/**
 * Format the clipboard payload that an analyst pastes into Claude.
 * Format is locked — see docs/pillar-prompt-contract.md before changing.
 */
export function composePayload({ webappUrl, analysisId, token }: PillarPromptArgs): string {
  return [
    'Run a pillar analysis narrative on this site.',
    '',
    `Webapp: ${webappUrl}`,
    `Analysis ID: ${analysisId}`,
    `Access token: ${token}`,
    '(Expires in 1h)',
    '',
    'Fetch the structured analysis, write the internal strategic memo, and post it back to the dashboard.',
  ].join('\n');
}

/**
 * Extract the three required fields from a pasted payload. Returns null
 * if any field is missing — the skill activation depends on all three
 * being present. Whitespace tolerant (some clipboard managers / chat UIs
 * normalize line endings).
 */
export interface PillarPromptFields {
  webappUrl: string;
  analysisId: string;
  token: string;
}

export const WEBAPP_URL_REGEX = /^[ \t]*Webapp:[ \t]+(\S+)\s*$/m;
export const ANALYSIS_ID_REGEX = /^[ \t]*Analysis ID:[ \t]+(\S+)\s*$/m;
export const TOKEN_REGEX = /^[ \t]*Access token:[ \t]+(pat_[A-Za-z0-9._-]+)\s*$/m;

export function parsePillarPrompt(text: string): PillarPromptFields | null {
  const webapp = text.match(WEBAPP_URL_REGEX)?.[1];
  const analysisId = text.match(ANALYSIS_ID_REGEX)?.[1];
  const token = text.match(TOKEN_REGEX)?.[1];
  if (!webapp || !analysisId || !token) return null;
  return { webappUrl: webapp, analysisId, token };
}
