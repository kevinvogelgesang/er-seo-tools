// lib/handoff/prompt-characterization.test.ts
// D1 frozen-wire net: EXACT clipboard payload strings for all six handoff
// families. If one of these fails, a wire contract consumed by the deployed
// er-handoff-memo skill has drifted — fix the code, never the test.
import { describe, it, expect } from 'vitest';
import { composePayload } from '../pillar-prompt';
import { composeRoadmapPayload } from '../seo-roadmap-prompt';
import { composeKeywordMemoPayload } from '../keyword-memo-prompt';
import { composeKeywordStrategyPayload } from '../keyword-strategy-prompt';
import { buildContentAuditPrompt } from '../content-audit-prompt';
import { composeQuarterPushPayload } from '../quarter-push-prompt';

describe('handoff prompt characterization (frozen wire)', () => {
  it('pat_ composePayload exact output', () => {
    expect(
      composePayload({ webappUrl: 'https://seo.example.com', analysisId: 'id-123', token: 'pat_tok' }),
    ).toBe(
      'Run a pillar analysis narrative on this site.\n\nWebapp: https://seo.example.com\nAnalysis ID: id-123\nAccess token: pat_tok\n(Expires in 1h)\n\nFetch the structured analysis, write the internal strategic memo, and post it back to the dashboard.',
    );
  });

  it('srt_ composeRoadmapPayload exact output', () => {
    expect(
      composeRoadmapPayload({ webappUrl: 'https://seo.example.com', roadmapId: 'id-123', token: 'srt_tok' }),
    ).toBe(
      'Generate a technical SEO roadmap for this site.\n\nWebapp: https://seo.example.com\nRoadmap ID: id-123\nAccess token: srt_tok\n(Expires in 1h)\n\nFetch the audit payload, write the prioritized technical-SEO roadmap, and post it back to the dashboard.',
    );
  });

  it('krt_ composeKeywordMemoPayload exact output', () => {
    expect(
      composeKeywordMemoPayload({ webappUrl: 'https://seo.example.com', memoId: 'id-123', token: 'krt_tok' }),
    ).toBe(
      'Generate a keyword strategy memo for this site.\n\nWebapp: https://seo.example.com\nMemo ID: id-123\nAccess token: krt_tok\n(Expires in 1h)\n\nFetch the keyword research payload, write the keyword strategy memo, and post it back to the dashboard.',
    );
  });

  it('kst_ composeKeywordStrategyPayload exact output', () => {
    expect(
      composeKeywordStrategyPayload({
        webappUrl: 'https://seo.example.com',
        strategyId: 'id-123',
        token: 'kst_tok',
      }),
    ).toBe(
      'Generate a keyword strategy document for this client.\n\nWebapp: https://seo.example.com\nStrategy ID: id-123\nAccess token: kst_tok\n(Expires in 1h)\n\nFetch the keyword strategy export, write the keyword strategy document, and post it back to the dashboard.',
    );
  });

  it('cat_ buildContentAuditPrompt exact output', () => {
    expect(
      buildContentAuditPrompt({ appUrl: 'https://seo.example.com', siteAuditId: 'id-123', token: 'cat_tok' }),
    ).toBe(
      "Run a content audit on this site audit's pages.\n\nWebapp: https://seo.example.com\nContent Audit ID: id-123\nAccess token: cat_tok\n(Expires in 1h)\n\nFetch the content-audit manifest, review the pages, and PATCH back\ncross-page consistency / stale-claim / quality findings.",
    );
  });

  it('qct_ composeQuarterPushPayload exact output', () => {
    expect(
      composeQuarterPushPayload({ webappUrl: 'https://seo.example.com', planId: 42, token: 'qct_tok' }),
    ).toBe(
      "Push the current quarter cycle to Teamwork.\n\nWebapp: https://seo.example.com\nPlan ID: 42\nAccess token: qct_tok\n(Expires in 1h)\n\nFetch the cycle export, create the planned-week tasks in each client's Teamwork tasklist, and post the push receipt back to the dashboard.",
    );
  });
});
