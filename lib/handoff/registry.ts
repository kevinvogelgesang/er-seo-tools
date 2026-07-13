// lib/handoff/registry.ts
// Server-only registry of the six handoff token families' literal config
// (D1 consolidation, Task 4). Every literal here is copied VERBATIM from its
// legacy lib/<x>-token.ts source module — see the per-family comments below
// for the source file. Task 5's token factory reads this registry instead
// of each module re-declaring its own constants; Task 6 re-points the
// legacy modules to become thin facades over the factory.
//
// Type discipline (Codex plan-review fix 4): HandoffTokenConfig is generic
// over its `scopes` tuple so each family's `as const satisfies
// HandoffTokenConfig` keeps its EXACT literal scopes tuple type (e.g.
// `readonly ['read', 'memo-write', 'volume-lookup']`), not a homogenized
// `readonly string[]`. Do not add an explicit `Record<HandoffFamilyKey,
// HandoffTokenConfig>` type annotation to HANDOFF_TOKEN_CONFIGS itself —
// that would widen every family back down to the generic default and erase
// the tuple types the later facades depend on. The `_shapeCheck` assignment
// below verifies Record-shape conformance without touching the export's
// inferred (narrow) type.
import 'server-only';
import type { HandoffFamilyKey } from './meta';
import {
  PillarTokenError,
  SeoRoadmapTokenError,
  KeywordMemoTokenError,
  KeywordStrategyTokenError,
  ContentAuditTokenError,
  QuarterPushTokenError,
} from './errors';

export interface HandoffTokenConfig<Scopes extends readonly string[] = readonly string[]> {
  /** Token string prefix, e.g. 'pat_'. Includes the trailing underscore. */
  prefix: string;
  /** JWT audience claim. Isolates same-secret families from each other. */
  audience: string;
  /** Name of the process.env var holding the signing secret. */
  secretEnv: string;
  /** Dev-only fallback secret used when secretEnv is unset outside production. */
  devFallbackSecret: string;
  /**
   * Leading `[module-tag]` on the dev-fallback console.warn line, e.g.
   * '[pillar-token]'. The factory reproduces the full legacy warning as
   * `${devFallbackWarnPrefix} ${secretEnv} unset; using dev fallback. Set the env var in production.`
   */
  devFallbackWarnPrefix: string;
  /** JWT scope claim values, in this family's own literal tuple order. */
  scopes: Scopes;
  /** Token lifetime in seconds (every family is 3600 / 1h today). */
  ttlSeconds: number;
  /** Human noun for the "does not match expected <noun> (<id>)" sub-mismatch message. */
  subNoun: string;
  /** Constructs this family's legacy error class. */
  makeError(message: string): Error;
}

// pat — source: lib/pillar-token.ts
const PAT_CONFIG = {
  prefix: 'pat_',
  audience: 'pillar-analysis-narrative',
  secretEnv: 'PILLAR_TOKEN_SECRET',
  devFallbackSecret: 'dev-pillar-token-secret-do-not-use-in-prod',
  devFallbackWarnPrefix: '[pillar-token]',
  scopes: ['read', 'narrative-write'],
  ttlSeconds: 3600,
  subNoun: 'analysis id',
  makeError: (message: string) => new PillarTokenError(message),
} as const satisfies HandoffTokenConfig;

// srt — source: lib/seo-roadmap-token.ts
const SRT_CONFIG = {
  prefix: 'srt_',
  audience: 'seo-audit-roadmap',
  secretEnv: 'SEO_ROADMAP_TOKEN_SECRET',
  devFallbackSecret: 'dev-seo-roadmap-secret-do-not-use-in-prod',
  devFallbackWarnPrefix: '[seo-roadmap-token]',
  scopes: ['read', 'roadmap-write'],
  ttlSeconds: 3600,
  subNoun: 'roadmap id',
  makeError: (message: string) => new SeoRoadmapTokenError(message),
} as const satisfies HandoffTokenConfig;

// krt — source: lib/keyword-memo-token.ts
const KRT_CONFIG = {
  prefix: 'krt_',
  audience: 'keyword-strategy-memo',
  secretEnv: 'KEYWORD_MEMO_TOKEN_SECRET',
  devFallbackSecret: 'dev-keyword-memo-secret-do-not-use-in-prod',
  devFallbackWarnPrefix: '[keyword-memo-token]',
  scopes: ['read', 'memo-write'],
  ttlSeconds: 3600,
  subNoun: 'memo id',
  makeError: (message: string) => new KeywordMemoTokenError(message),
} as const satisfies HandoffTokenConfig;

// kst — source: lib/keyword-strategy-token.ts
// Deliberately shares KEYWORD_MEMO_TOKEN_SECRET with krt/cat; AUDIENCE is the
// isolation wall (see lib/handoff/cross-family-characterization.test.ts).
const KST_CONFIG = {
  prefix: 'kst_',
  audience: 'keyword-strategy-client',
  secretEnv: 'KEYWORD_MEMO_TOKEN_SECRET',
  devFallbackSecret: 'dev-keyword-memo-secret-do-not-use-in-prod',
  devFallbackWarnPrefix: '[keyword-strategy-token]',
  scopes: ['read', 'memo-write', 'volume-lookup'],
  ttlSeconds: 3600,
  subNoun: 'session id',
  makeError: (message: string) => new KeywordStrategyTokenError(message),
} as const satisfies HandoffTokenConfig;

// cat — source: lib/content-audit-token.ts
// Also deliberately shares KEYWORD_MEMO_TOKEN_SECRET; AUDIENCE isolates it
// from krt/kst.
const CAT_CONFIG = {
  prefix: 'cat_',
  audience: 'content-audit-client',
  secretEnv: 'KEYWORD_MEMO_TOKEN_SECRET',
  devFallbackSecret: 'dev-keyword-memo-secret-do-not-use-in-prod',
  devFallbackWarnPrefix: '[content-audit-token]',
  scopes: ['read', 'findings-write'],
  ttlSeconds: 3600,
  subNoun: 'site audit id',
  makeError: (message: string) => new ContentAuditTokenError(message),
} as const satisfies HandoffTokenConfig;

// qct — source: lib/quarter-push-token.ts
const QCT_CONFIG = {
  prefix: 'qct_',
  audience: 'quarter-cycle-push',
  secretEnv: 'QUARTER_PUSH_TOKEN_SECRET',
  devFallbackSecret: 'dev-quarter-push-secret-do-not-use-in-prod',
  devFallbackWarnPrefix: '[quarter-push-token]',
  scopes: ['read', 'receipt-write'],
  ttlSeconds: 3600,
  subNoun: 'plan id',
  makeError: (message: string) => new QuarterPushTokenError(message),
} as const satisfies HandoffTokenConfig;

export const HANDOFF_TOKEN_CONFIGS = {
  pat: PAT_CONFIG,
  srt: SRT_CONFIG,
  krt: KRT_CONFIG,
  kst: KST_CONFIG,
  cat: CAT_CONFIG,
  qct: QCT_CONFIG,
} as const;

// Compile-time-only conformance check: every family config is assignable to
// the general HandoffTokenConfig shape and every HandoffFamilyKey is
// present. This does NOT change HANDOFF_TOKEN_CONFIGS's exported (narrow,
// per-family-literal) type above — it's a separate binding used only to
// catch a missing/malformed family at typecheck time.
const _shapeCheck: Record<HandoffFamilyKey, HandoffTokenConfig> = HANDOFF_TOKEN_CONFIGS;
void _shapeCheck;
