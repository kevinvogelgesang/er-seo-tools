// lib/handoff/registry.test.ts
// Literal-pinning test for the D1 HANDOFF_TOKEN_CONFIGS registry (Task 4).
// Every value asserted here is copied verbatim from the corresponding
// legacy lib/<x>-token.ts source module — a failure means the registry
// drifted from the source of truth, not that the test is wrong.
import { describe, it, expect } from 'vitest';
import { HANDOFF_TOKEN_CONFIGS } from './registry';
import { HANDOFF_META } from './meta';

describe('HANDOFF_TOKEN_CONFIGS literals', () => {
  it('pins pat to lib/pillar-token.ts', () => {
    expect(HANDOFF_TOKEN_CONFIGS.pat).toMatchObject({
      prefix: 'pat_',
      audience: 'pillar-analysis-narrative',
      secretEnv: 'PILLAR_TOKEN_SECRET',
      devFallbackSecret: 'dev-pillar-token-secret-do-not-use-in-prod',
      devFallbackWarnPrefix: '[pillar-token]',
      ttlSeconds: 3600,
      scopes: ['read', 'narrative-write'],
      subNoun: 'analysis id',
    });
  });

  it('pins srt to lib/seo-roadmap-token.ts', () => {
    expect(HANDOFF_TOKEN_CONFIGS.srt).toMatchObject({
      prefix: 'srt_',
      audience: 'seo-audit-roadmap',
      secretEnv: 'SEO_ROADMAP_TOKEN_SECRET',
      devFallbackSecret: 'dev-seo-roadmap-secret-do-not-use-in-prod',
      devFallbackWarnPrefix: '[seo-roadmap-token]',
      ttlSeconds: 3600,
      scopes: ['read', 'roadmap-write'],
      subNoun: 'roadmap id',
    });
  });

  it('pins krt to lib/keyword-memo-token.ts', () => {
    expect(HANDOFF_TOKEN_CONFIGS.krt).toMatchObject({
      prefix: 'krt_',
      audience: 'keyword-strategy-memo',
      secretEnv: 'KEYWORD_MEMO_TOKEN_SECRET',
      devFallbackSecret: 'dev-keyword-memo-secret-do-not-use-in-prod',
      devFallbackWarnPrefix: '[keyword-memo-token]',
      ttlSeconds: 3600,
      scopes: ['read', 'memo-write'],
      subNoun: 'memo id',
    });
  });

  it('pins kst to lib/keyword-strategy-token.ts (shares KEYWORD_MEMO_TOKEN_SECRET with krt/cat by design)', () => {
    expect(HANDOFF_TOKEN_CONFIGS.kst).toMatchObject({
      prefix: 'kst_',
      audience: 'keyword-strategy-client',
      secretEnv: 'KEYWORD_MEMO_TOKEN_SECRET',
      devFallbackSecret: 'dev-keyword-memo-secret-do-not-use-in-prod',
      devFallbackWarnPrefix: '[keyword-strategy-token]',
      ttlSeconds: 3600,
      scopes: ['read', 'memo-write', 'volume-lookup'],
      subNoun: 'session id',
    });
  });

  it('pins cat to lib/content-audit-token.ts (shares KEYWORD_MEMO_TOKEN_SECRET with krt/kst by design)', () => {
    expect(HANDOFF_TOKEN_CONFIGS.cat).toMatchObject({
      prefix: 'cat_',
      audience: 'content-audit-client',
      secretEnv: 'KEYWORD_MEMO_TOKEN_SECRET',
      devFallbackSecret: 'dev-keyword-memo-secret-do-not-use-in-prod',
      devFallbackWarnPrefix: '[content-audit-token]',
      ttlSeconds: 3600,
      scopes: ['read', 'findings-write'],
      subNoun: 'site audit id',
    });
  });

  it('pins qct to lib/quarter-push-token.ts', () => {
    expect(HANDOFF_TOKEN_CONFIGS.qct).toMatchObject({
      prefix: 'qct_',
      audience: 'quarter-cycle-push',
      secretEnv: 'QUARTER_PUSH_TOKEN_SECRET',
      devFallbackSecret: 'dev-quarter-push-secret-do-not-use-in-prod',
      devFallbackWarnPrefix: '[quarter-push-token]',
      ttlSeconds: 3600,
      scopes: ['read', 'receipt-write'],
      subNoun: 'plan id',
    });
  });

  it('makeError constructs the legacy class with preserved name, per family', () => {
    expect(HANDOFF_TOKEN_CONFIGS.pat.makeError('boom').name).toBe('PillarTokenError');
    expect(HANDOFF_TOKEN_CONFIGS.srt.makeError('boom').name).toBe('SeoRoadmapTokenError');
    expect(HANDOFF_TOKEN_CONFIGS.krt.makeError('boom').name).toBe('KeywordMemoTokenError');
    expect(HANDOFF_TOKEN_CONFIGS.kst.makeError('boom').name).toBe('KeywordStrategyTokenError');
    expect(HANDOFF_TOKEN_CONFIGS.cat.makeError('boom').name).toBe('ContentAuditTokenError');
    expect(HANDOFF_TOKEN_CONFIGS.qct.makeError('boom').name).toBe('QuarterPushTokenError');

    const e = HANDOFF_TOKEN_CONFIGS.pat.makeError('boom');
    expect(e.message).toBe('boom');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('HANDOFF_TOKEN_CONFIGS route-auth policy (Task 8)', () => {
  it('pins transport per family — bearer-or-query is cat_ ONLY', () => {
    expect(HANDOFF_TOKEN_CONFIGS.pat.transport).toBe('bearer-strict');
    expect(HANDOFF_TOKEN_CONFIGS.srt.transport).toBe('bearer-strict');
    expect(HANDOFF_TOKEN_CONFIGS.krt.transport).toBe('bearer-strict');
    expect(HANDOFF_TOKEN_CONFIGS.kst.transport).toBe('bearer-strict');
    expect(HANDOFF_TOKEN_CONFIGS.qct.transport).toBe('bearer-strict');
    expect(HANDOFF_TOKEN_CONFIGS.cat.transport).toBe('bearer-or-query');
  });

  it('pins the literal authErrors codes for pat_/srt_/krt_/kst_ (auth_missing/auth_malformed split, 500 unavailable)', () => {
    for (const key of ['pat', 'srt', 'krt', 'kst'] as const) {
      const { authErrors } = HANDOFF_TOKEN_CONFIGS[key];
      expect(authErrors.missingHeader).toEqual({ error: 'auth_missing', status: 401 });
      expect(authErrors.malformedHeader).toEqual({ error: 'auth_malformed', status: 401 });
      expect(authErrors.verifierUnavailable).toEqual({ error: 'token_service_unavailable', status: 500 });
      expect(authErrors.missingScope).toEqual({ error: 'token_missing_scope', status: 401 });
    }
  });

  it('pins the qct_ authErrors codes (no-header AND malformed collapse into ONE code)', () => {
    const { authErrors } = HANDOFF_TOKEN_CONFIGS.qct;
    expect(authErrors.missingHeader).toEqual({ error: 'auth_missing_or_malformed', status: 401 });
    expect(authErrors.malformedHeader).toEqual({ error: 'auth_missing_or_malformed', status: 401 });
    expect(authErrors.verifierUnavailable).toEqual({ error: 'token_service_unavailable', status: 500 });
    expect(authErrors.missingScope).toEqual({ error: 'token_missing_scope', status: 401 });
  });

  it('pins the cat_ authErrors codes (every token-shape failure collapses to auth_required; scope failure is insufficient_scope)', () => {
    const { authErrors } = HANDOFF_TOKEN_CONFIGS.cat;
    expect(authErrors.missingHeader).toEqual({ error: 'auth_required', status: 401 });
    expect(authErrors.malformedHeader).toEqual({ error: 'auth_required', status: 401 });
    expect(authErrors.verifierUnavailable).toEqual({ error: 'auth_required', status: 401 });
    expect(authErrors.missingScope).toEqual({ error: 'insufficient_scope', status: 401 });
    expect(authErrors.tokenError('does not match expected site audit id')).toEqual({
      error: 'auth_required',
      status: 401,
    });
    expect(authErrors.tokenError('anything at all')).toEqual({ error: 'auth_required', status: 401 });
  });

  it('tokenError() sniffs expired/does-not-match/signature/fallback per family, with the family-specific wrong-sub code', () => {
    const cases: Array<{ key: 'pat' | 'srt' | 'krt' | 'kst' | 'qct'; wrongSubCode: string }> = [
      { key: 'pat', wrongSubCode: 'token_wrong_analysis_id' },
      { key: 'srt', wrongSubCode: 'token_wrong_roadmap_id' },
      { key: 'krt', wrongSubCode: 'token_wrong_memo_id' },
      { key: 'kst', wrongSubCode: 'token_wrong_session_id' },
      { key: 'qct', wrongSubCode: 'token_wrong_plan_id' },
    ];
    for (const { key, wrongSubCode } of cases) {
      const { tokenError } = HANDOFF_TOKEN_CONFIGS[key].authErrors;
      expect(tokenError('token verification failed: "exp" claim timestamp check failed')).toEqual({
        error: 'token_invalid',
        status: 401,
      });
      expect(tokenError('token EXPIRED nonsense')).toEqual({ error: 'token_expired', status: 401 });
      expect(tokenError('token sub (a) does not match expected foo (b)')).toEqual({
        error: wrongSubCode,
        status: 401,
      });
      expect(tokenError('invalid signature')).toEqual({ error: 'token_invalid_signature', status: 401 });
      expect(tokenError('token missing pat_ prefix')).toEqual({ error: 'token_invalid', status: 401 });
    }
  });
});

describe('HANDOFF_META', () => {
  it('pins prefix + idLabel per family, verified against each prompt module', () => {
    expect(HANDOFF_META).toMatchObject({
      pat: { prefix: 'pat_', idLabel: 'Analysis ID' },
      srt: { prefix: 'srt_', idLabel: 'Roadmap ID' },
      krt: { prefix: 'krt_', idLabel: 'Memo ID' },
      kst: { prefix: 'kst_', idLabel: 'Strategy ID' },
      cat: { prefix: 'cat_', idLabel: 'Content Audit ID' },
      qct: { prefix: 'qct_', idLabel: 'Plan ID' },
    });
  });

  it('meta prefixes match the registry prefixes for every family', () => {
    for (const key of Object.keys(HANDOFF_META) as Array<keyof typeof HANDOFF_META>) {
      expect(HANDOFF_META[key].prefix).toBe(HANDOFF_TOKEN_CONFIGS[key].prefix);
    }
  });

  // Task 7 (D1 PR1): pins introLine/outroLine verbatim per family, copied
  // from each composer's original source (see git history of
  // lib/*-prompt.ts pre-facade). A failure here means composeHandoffPayload's
  // frozen-wire inputs drifted — lib/handoff/prompt-characterization.test.ts
  // is the ground truth if these ever disagree.
  it('pins introLine + outroLine per family, verbatim from each original composer', () => {
    expect(HANDOFF_META).toEqual({
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
    });
  });
});
