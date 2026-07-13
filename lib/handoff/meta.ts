// lib/handoff/meta.ts
// Client-safe metadata for the six handoff token families (D1 consolidation).
// This module (and everything it imports) must NEVER import 'server-only' —
// client components (dashboard clipboard buttons, mint-token cards) import
// it directly. `HandoffFamilyKey` is the shared family-id union; it is
// declared HERE (not in registry.ts) specifically so that importing it never
// drags in a server-only module transitively, even via a type-only import.

export type HandoffFamilyKey = 'pat' | 'srt' | 'krt' | 'kst' | 'cat' | 'qct';

export interface HandoffMeta {
  prefix: string;
  idLabel: string;
  /** First line of the clipboard prompt (verbatim from the family's composer). */
  introLine: string;
  /**
   * Line(s) after the `(Expires in 1h)` blank-line separator. May itself
   * contain embedded `\n` (cat_'s two-sentence closer) — composeHandoffPayload
   * joins the whole line array with `\n`, so an embedded `\n` here reproduces
   * the same bytes as if the closer were split across two array elements.
   */
  outroLine: string;
}

export const HANDOFF_META: Record<HandoffFamilyKey, HandoffMeta> = {
  pat: {
    prefix: 'pat_',
    idLabel: 'Analysis ID',
    introLine: 'Run a pillar analysis narrative on this site.',
    outroLine:
      'Fetch the structured analysis, write the internal strategic memo, and post it back to the dashboard.',
  },
  srt: {
    prefix: 'srt_',
    idLabel: 'Roadmap ID',
    introLine: 'Generate a technical SEO roadmap for this site.',
    outroLine:
      'Fetch the audit payload, write the prioritized technical-SEO roadmap, and post it back to the dashboard.',
  },
  krt: {
    prefix: 'krt_',
    idLabel: 'Memo ID',
    introLine: 'Generate a keyword strategy memo for this site.',
    outroLine:
      'Fetch the keyword research payload, write the keyword strategy memo, and post it back to the dashboard.',
  },
  kst: {
    prefix: 'kst_',
    idLabel: 'Strategy ID',
    introLine: 'Generate a keyword strategy document for this client.',
    outroLine:
      'Fetch the keyword strategy export, write the keyword strategy document, and post it back to the dashboard.',
  },
  cat: {
    prefix: 'cat_',
    idLabel: 'Content Audit ID',
    introLine: "Run a content audit on this site audit's pages.",
    outroLine:
      'Fetch the content-audit manifest, review the pages, and PATCH back\ncross-page consistency / stale-claim / quality findings.',
  },
  qct: {
    prefix: 'qct_',
    idLabel: 'Plan ID',
    introLine: 'Push the current quarter cycle to Teamwork.',
    outroLine:
      "Fetch the cycle export, create the planned-week tasks in each client's Teamwork tasklist, and post the push receipt back to the dashboard.",
  },
};
