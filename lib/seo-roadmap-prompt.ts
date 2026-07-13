// lib/seo-roadmap-prompt.ts
// Thin facade over lib/handoff/prompt.ts's composeHandoffPayload (D1
// consolidation) — byte-identical output, gated by
// lib/handoff/prompt-characterization.test.ts.
import { composeHandoffPayload } from './handoff/prompt';

export interface RoadmapPromptArgs {
  webappUrl: string;
  roadmapId: string;
  token: string;
}

export function composeRoadmapPayload({ webappUrl, roadmapId, token }: RoadmapPromptArgs): string {
  return composeHandoffPayload('srt', { webappUrl, id: roadmapId, token });
}
