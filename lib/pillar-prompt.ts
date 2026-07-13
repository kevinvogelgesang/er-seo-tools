// lib/pillar-prompt.ts
// Canonical composer + parser for the pillar-analysis clipboard prompt.
// Used by the dashboard's CopyClaudePromptButton (compose) and by the
// regression test (parse). The skill (Phase 2.2) documents the same
// regex pattern in its SKILL.md — see docs/pillar-prompt-contract.md
// for the single source of truth.
//
// composePayload is now a thin facade over lib/handoff/prompt.ts's
// composeHandoffPayload (D1 consolidation) — byte-identical output, gated
// by lib/handoff/prompt-characterization.test.ts. parsePillarPrompt + its
// regexes are untouched: they are consumed directly by the er-handoff-memo
// skill's contract (docs/pillar-prompt-contract.md) and stay put.
import { composeHandoffPayload } from './handoff/prompt';

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
  return composeHandoffPayload('pat', { webappUrl, id: analysisId, token });
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
