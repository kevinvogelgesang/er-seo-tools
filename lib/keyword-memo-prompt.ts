// lib/keyword-memo-prompt.ts
// Thin facade over lib/handoff/prompt.ts's composeHandoffPayload (D1
// consolidation) — byte-identical output, gated by
// lib/handoff/prompt-characterization.test.ts.
import { composeHandoffPayload } from './handoff/prompt';

export interface KeywordMemoPromptArgs {
  webappUrl: string;
  memoId: string;
  token: string;
}

export function composeKeywordMemoPayload({ webappUrl, memoId, token }: KeywordMemoPromptArgs): string {
  return composeHandoffPayload('krt', { webappUrl, id: memoId, token });
}
