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
