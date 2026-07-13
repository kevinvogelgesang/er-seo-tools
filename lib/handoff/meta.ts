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
}

export const HANDOFF_META: Record<HandoffFamilyKey, HandoffMeta> = {
  pat: { prefix: 'pat_', idLabel: 'Analysis ID' },
  srt: { prefix: 'srt_', idLabel: 'Roadmap ID' },
  krt: { prefix: 'krt_', idLabel: 'Memo ID' },
  kst: { prefix: 'kst_', idLabel: 'Strategy ID' },
  cat: { prefix: 'cat_', idLabel: 'Content Audit ID' },
  qct: { prefix: 'qct_', idLabel: 'Plan ID' },
};
