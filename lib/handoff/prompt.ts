// lib/handoff/prompt.ts
// Client-safe shared composer for the six handoff clipboard prompts (D1
// consolidation, Task 7). Must NEVER import 'server-only' — client
// components (e.g. components/clients/KeywordStrategyCard.tsx, via the
// lib/*-prompt.ts facades) call this at render time.
//
// All six families share the exact structure below (verified against
// lib/handoff/prompt-characterization.test.ts, the frozen-wire ground
// truth): introLine / blank / Webapp / <idLabel>: <id> / Access token /
// (Expires in 1h) / blank / outroLine. cat_'s outroLine embeds a `\n` for
// its two-sentence closer — `.join('\n')` reproduces the identical bytes
// either way, so it rides the shared path too. If a future family's shape
// genuinely can't fit this, keep it out of HANDOFF_META and compose it
// inline in its own facade instead of contorting this function.
import type { HandoffFamilyKey } from './meta';
import { HANDOFF_META } from './meta';

export interface ComposeHandoffPayloadArgs {
  webappUrl: string;
  id: string;
  token: string;
}

export function composeHandoffPayload(
  family: HandoffFamilyKey,
  { webappUrl, id, token }: ComposeHandoffPayloadArgs,
): string {
  const { idLabel, introLine, outroLine } = HANDOFF_META[family];
  return [
    introLine,
    '',
    `Webapp: ${webappUrl}`,
    `${idLabel}: ${id}`,
    `Access token: ${token}`,
    '(Expires in 1h)',
    '',
    outroLine,
  ].join('\n');
}
