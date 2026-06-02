# Pillar Analysis Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the deterministic backbone of the pillar-analysis feature in `er-seo-tools` — per-URL data join, page-type/intent classification, embedding-based topic clustering, site fit score, hub-format decision, per-URL verdicts — surfaced in a new internal dashboard at `/pillar-analysis/[id]`. No skill, no clipboard payload, no narrative writeback. Those ship in Phase 2.

**Architecture:** Pure server-side TypeScript. New service folder under `lib/services/pillarAnalysis/` containing one focused module per concern. Topic clustering uses `@xenova/transformers` running locally (no external API calls). Persisted as a new `PillarAnalysis` Prisma model linked to the existing `Session` (seo-parser crawl). Dashboard renders raw deterministic output; analyst reads it directly.

**Tech Stack:** Next.js 15 App Router, TypeScript 5.3, Prisma 5.22 + SQLite, Tailwind CSS, Recharts (lazy), Vitest 2.1, `@xenova/transformers` (new), `papaparse` (existing).

**Spec:** `docs/superpowers/specs/2026-04-28-pillar-analysis-design.md`

**Branch:** `feature/pillar-analysis-phase-1`

---

## Pre-flight

Before Task 1, agent should:
1. `cd` into the `er-seo-tools` repo working tree.
2. `git checkout -b feature/pillar-analysis-phase-1` from a clean `main`.
3. Verify `npm install` runs cleanly and `npm test` passes on the existing suite (baseline).

---

## Task 1: Add `@xenova/transformers` dependency and pre-warm hook

**Files:**
- Modify: `package.json`
- Create: `scripts/prewarm-embedding-model.ts`
- Modify: `package.json` (postinstall script)

- [ ] **Step 1: Add the dependency**

```bash
npm install @xenova/transformers@^2.17.2
```

Expected: `package.json` and `package-lock.json` updated with the dep at `dependencies`.

- [ ] **Step 2: Create the pre-warm script**

Create `scripts/prewarm-embedding-model.ts`:

```ts
// Downloads and caches the MiniLM model so the first pillar-analysis run
// after a deploy doesn't pay the ~25MB download.
import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false; // force fresh download to model cache

async function prewarm() {
  console.log('Pre-warming Xenova/all-MiniLM-L6-v2...');
  const start = Date.now();
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  // Run one inference to fully load weights
  await extractor('warmup', { pooling: 'mean', normalize: true });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Pre-warm complete in ${elapsed}s`);
}

prewarm().catch((err) => {
  console.error('Pre-warm failed (continuing anyway):', err);
  process.exit(0); // non-fatal — pre-warm is an optimization
});
```

- [ ] **Step 3: Add postinstall hook to `package.json`**

In `scripts` section of `package.json`, add:

```json
"postinstall": "tsx scripts/prewarm-embedding-model.ts || true"
```

(`|| true` keeps `npm install` succeeding even if pre-warm fails — it's an optimization, not a hard dep.)

If `tsx` isn't already in devDependencies, add it:

```bash
npm install --save-dev tsx@^4.7.0
```

- [ ] **Step 4: Verify the pre-warm runs**

Run: `npm run --silent postinstall`
Expected: prints `Pre-warming Xenova/all-MiniLM-L6-v2...` then `Pre-warm complete in {N}s`. Model files appear in `~/.cache/huggingface/transformers/` (or platform equivalent).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/prewarm-embedding-model.ts
git commit -m "feat: add @xenova/transformers + postinstall model prewarm"
```

---

## Task 2: Add `PillarAnalysis` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_pillar_analysis/migration.sql` (auto-generated)

- [ ] **Step 1: Add model to `prisma/schema.prisma`**

Add at the end of the file:

```prisma
model PillarAnalysis {
  id                  String   @id @default(cuid())
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  sessionId           String   // FK to Session (the seo-parser crawl)
  session             Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  status              String   @default("pending") // pending | running | complete | error
  error               String?
  runnerVersion       String   @default("1.0.0")

  // Deterministic outputs (JSON-serialized — SQLite has no native JSON type)
  score               Int?     // 1-10 site fit score
  subscores           String?  // JSON: { contentVolume, topicalConcentration, ... }
  dataCompleteness    Float?   // 0.0-1.0 fraction of subscores with real data
  hubRecommendation   String?  // JSON: { primary, alternates: [{format, scoreDelta}] }
  pillarTopics        String?  // JSON: array of cluster groupings
  urlVerdicts         String?  // JSON: array of UrlRecord

  // Phase 2 narrative slot — declared now to avoid migration churn later
  aiNarrative         String?
  narrativeUpdatedAt  DateTime?

  @@index([sessionId])
  @@index([status])
  @@index([createdAt])
}
```

Also add the back-relation on `Session`:

```prisma
model Session {
  // ...existing fields...
  pillarAnalyses PillarAnalysis[]
}
```

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --name add_pillar_analysis`
Expected: new folder `prisma/migrations/<timestamp>_add_pillar_analysis/` with `migration.sql` containing `CREATE TABLE "PillarAnalysis"`. Prisma client regenerates.

- [ ] **Step 3: Verify the model is queryable**

Open `prisma/schema.prisma` and confirm structure. Then run:

```bash
npx tsx -e "import { prisma } from './lib/db.ts'; prisma.pillarAnalysis.count().then(c => console.log('count:', c)).finally(() => prisma.\$disconnect())"
```

Expected: prints `count: 0`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add PillarAnalysis Prisma model + migration"
```

---

## Task 3: Define core types

**Files:**
- Create: `lib/services/pillarAnalysis/types.ts`

- [ ] **Step 1: Write the types file**

```ts
// lib/services/pillarAnalysis/types.ts

export type PageType =
  | 'program'
  | 'blog'
  | 'news'
  | 'resource'
  | 'nav'
  | 'home'
  | 'unknown';

export type IntentClass =
  | 'informational'
  | 'commercial'
  | 'transactional'
  | 'navigational'
  | 'unknown';

export type Verdict =
  | 'pillar'
  | 'cluster'
  | 'leave-as-blog'
  | 'consolidate'
  | 'prune'
  | 'unclear';

export type HubFormat =
  | 'nest-under-programs'
  | 'hybrid'
  | 'rename-blog-to-resources'
  | 'fresh-resources-hub'
  | 'fresh-career-guides-hub';

export interface UrlRecord {
  url: string;
  pageType: PageType;
  pageTypeConfidence: number;

  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  firstParagraph: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  inlinks: number | null;
  outlinks: number | null;
  indexable: boolean;

  gscClicks: number | null;
  gscImpressions: number | null;
  gscCtr: number | null;
  gscPosition: number | null;

  ga4Sessions: number | null;
  ga4EngagementRate: number | null;
  ga4KeyEvents: number | null;

  referringDomains: number | null;
  organicKeywords: number | null;

  intentClass: IntentClass;
  intentConfidence: number;
  topicClusterId: number | null;
  verdict: Verdict;
  verdictConfidence: number;
  recommendedPillar: string | null;
  reasoning: string[];
}

export interface SubscoreBreakdown {
  contentVolume: number;
  topicalConcentration: number;
  organicFootprint: number;
  internalLinkGap: number;
  programPageClarity: number;
  backlinkDistribution: number;
}

export interface HubRecommendation {
  primary: HubFormat;
  alternates: Array<{ format: HubFormat; scoreDelta: number }>;
  reasoning: string[];
}

export interface PillarTopic {
  clusterId: number;
  name: string;            // derived from top-frequency terms
  pillarUrl: string | null; // anchor candidate, null if cluster too small
  clusterUrls: string[];
  size: number;
}

export interface PillarAnalysisResult {
  score: number;            // 1-10
  subscores: SubscoreBreakdown;
  dataCompleteness: number; // 0.0-1.0
  hubRecommendation: HubRecommendation;
  pillarTopics: PillarTopic[];
  urlVerdicts: UrlRecord[];
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/services/pillarAnalysis/types.ts
git commit -m "feat(pillar): add core types"
```

---

## Task 4: Define configurable thresholds and weights

**Files:**
- Create: `lib/services/pillarAnalysis/config.ts`
- Create: `lib/services/pillarAnalysis/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis/config.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from './config';

describe('pillarAnalysis config', () => {
  it('subscore weights sum to 1.0', () => {
    const w = DEFAULT_CONFIG.subscoreWeights;
    const sum = w.contentVolume + w.topicalConcentration + w.organicFootprint
      + w.internalLinkGap + w.programPageClarity + w.backlinkDistribution;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('mergeConfig overrides only provided keys', () => {
    const merged = mergeConfig({ clusterSimilarityThreshold: 0.7 });
    expect(merged.clusterSimilarityThreshold).toBe(0.7);
    expect(merged.nearDuplicateThreshold).toBe(DEFAULT_CONFIG.nearDuplicateThreshold);
    expect(merged.subscoreWeights).toEqual(DEFAULT_CONFIG.subscoreWeights);
  });

  it('mergeConfig deep-merges subscoreWeights', () => {
    const merged = mergeConfig({ subscoreWeights: { contentVolume: 0.30 } as any });
    expect(merged.subscoreWeights.contentVolume).toBe(0.30);
    expect(merged.subscoreWeights.topicalConcentration).toBe(DEFAULT_CONFIG.subscoreWeights.topicalConcentration);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/config.test.ts`
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/pillarAnalysis/config.ts

export interface PillarConfig {
  clusterSimilarityThreshold: number;   // MiniLM cosine cut for cluster membership
  nearDuplicateThreshold: number;       // MiniLM cosine for `consolidate` verdict
  verticalAlignmentThreshold: number;   // cluster-to-program alignment threshold
  minClusterSize: number;               // min pages to constitute a "cluster"
  thinContentMaxWords: number;          // word count below which content is "thin"
  pruneMaxWords: number;                // word count below which content is `prune`-eligible
  subscoreWeights: {
    contentVolume: number;
    topicalConcentration: number;
    organicFootprint: number;
    internalLinkGap: number;
    programPageClarity: number;
    backlinkDistribution: number;
  };
}

export const DEFAULT_CONFIG: PillarConfig = {
  clusterSimilarityThreshold: 0.55,
  nearDuplicateThreshold: 0.85,
  verticalAlignmentThreshold: 0.55,
  minClusterSize: 3,
  thinContentMaxWords: 500,
  pruneMaxWords: 100,
  subscoreWeights: {
    contentVolume: 0.25,
    topicalConcentration: 0.20,
    organicFootprint: 0.20,
    internalLinkGap: 0.15,
    programPageClarity: 0.15,
    backlinkDistribution: 0.05,
  },
};

export function mergeConfig(overrides: Partial<PillarConfig>): PillarConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    subscoreWeights: {
      ...DEFAULT_CONFIG.subscoreWeights,
      ...(overrides.subscoreWeights || {}),
    },
  };
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/config.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/config.ts lib/services/pillarAnalysis/config.test.ts
git commit -m "feat(pillar): add config module with defaults + per-client merge"
```

---

## Task 5: Page-type classifier

**Files:**
- Create: `lib/services/pillarAnalysis/pageType.ts`
- Create: `lib/services/pillarAnalysis/pageType.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis/pageType.test.ts
import { describe, it, expect } from 'vitest';
import { classifyPageType } from './pageType';

describe('classifyPageType', () => {
  it('URL-slug primary: /programs/ → program with high confidence', () => {
    const r = classifyPageType({
      url: 'https://example.edu/programs/nursing',
      schemaTypes: [],
      crawlDepth: 2,
    });
    expect(r.pageType).toBe('program');
    expect(r.pageTypeConfidence).toBeGreaterThanOrEqual(0.85);
  });

  it('URL-slug primary: /blog/post → blog', () => {
    const r = classifyPageType({
      url: 'https://example.edu/blog/nursing-tips',
      schemaTypes: [],
      crawlDepth: 3,
    });
    expect(r.pageType).toBe('blog');
  });

  it('URL-slug primary: /resources/ → resource', () => {
    const r = classifyPageType({
      url: 'https://example.edu/resources/financial-aid',
      schemaTypes: [],
      crawlDepth: 3,
    });
    expect(r.pageType).toBe('resource');
  });

  it('URL-slug primary: /career-guides/ → resource', () => {
    const r = classifyPageType({
      url: 'https://example.edu/career-guides/become-rn',
      schemaTypes: [],
      crawlDepth: 3,
    });
    expect(r.pageType).toBe('resource');
  });

  it('schema fallback: ambiguous slug + Course schema → program', () => {
    const r = classifyPageType({
      url: 'https://example.edu/learn/intro',
      schemaTypes: ['Course'],
      crawlDepth: 2,
    });
    expect(r.pageType).toBe('program');
    expect(r.pageTypeConfidence).toBeLessThan(0.85);
    expect(r.pageTypeConfidence).toBeGreaterThanOrEqual(0.6);
  });

  it('schema fallback: BlogPosting → blog', () => {
    const r = classifyPageType({
      url: 'https://example.edu/learn/study-tips',
      schemaTypes: ['BlogPosting'],
      crawlDepth: 3,
    });
    expect(r.pageType).toBe('blog');
  });

  it('depth fallback: shallow + no signals → home/nav', () => {
    const r = classifyPageType({
      url: 'https://example.edu/welcome',
      schemaTypes: [],
      crawlDepth: 1,
    });
    expect(['home', 'nav', 'unknown']).toContain(r.pageType);
    expect(r.pageTypeConfidence).toBeLessThan(0.6);
  });

  it('homepage: depth 0 → home', () => {
    const r = classifyPageType({
      url: 'https://example.edu/',
      schemaTypes: [],
      crawlDepth: 0,
    });
    expect(r.pageType).toBe('home');
  });

  it('nav slug: /about/ → nav', () => {
    const r = classifyPageType({
      url: 'https://example.edu/about/leadership',
      schemaTypes: [],
      crawlDepth: 2,
    });
    expect(r.pageType).toBe('nav');
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/pageType.test.ts`
Expected: FAIL — `Cannot find module './pageType'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/pillarAnalysis/pageType.ts
import type { PageType } from './types';

export interface PageTypeInput {
  url: string;
  schemaTypes: string[]; // schema.org @type values found on the page
  crawlDepth: number | null;
}

export interface PageTypeResult {
  pageType: PageType;
  pageTypeConfidence: number;
}

const SLUG_RULES: Array<{ pattern: RegExp; type: PageType }> = [
  { pattern: /\/programs?\//i, type: 'program' },
  { pattern: /\/(blog|news)\//i, type: 'blog' },
  { pattern: /\/(resources?|career[-_]guides?|guides?)\//i, type: 'resource' },
  { pattern: /\/(about|contact|team|staff|leadership|careers)(\/|$)/i, type: 'nav' },
];

const SCHEMA_RULES: Record<string, PageType> = {
  Course: 'program',
  EducationalOccupationalProgram: 'program',
  Article: 'blog',
  BlogPosting: 'blog',
  NewsArticle: 'news',
};

export function classifyPageType(input: PageTypeInput): PageTypeResult {
  const path = safeUrlPath(input.url);

  // Homepage
  if (path === '/' || path === '') {
    return { pageType: 'home', pageTypeConfidence: 0.95 };
  }

  // 1. URL-slug primary (high confidence when matched)
  const slugMatches = SLUG_RULES.filter((r) => r.pattern.test(path));
  if (slugMatches.length === 1) {
    return { pageType: slugMatches[0].type, pageTypeConfidence: 0.85 };
  }
  if (slugMatches.length > 1) {
    // Ambiguous — fall through to schema
  }

  // 2. Schema.org tiebreaker (medium confidence)
  for (const schemaType of input.schemaTypes) {
    if (schemaType in SCHEMA_RULES) {
      return { pageType: SCHEMA_RULES[schemaType], pageTypeConfidence: 0.7 };
    }
  }

  // 3. Crawl-depth tertiary (low confidence)
  const depth = input.crawlDepth ?? 99;
  if (depth <= 2) {
    return { pageType: 'nav', pageTypeConfidence: 0.4 };
  }

  return { pageType: 'unknown', pageTypeConfidence: 0.2 };
}

function safeUrlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/pageType.test.ts`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/pageType.ts lib/services/pillarAnalysis/pageType.test.ts
git commit -m "feat(pillar): hierarchical page-type classifier (slug primary, schema/depth tiebreakers)"
```

---

## Task 6: Intent classifier

**Files:**
- Create: `lib/services/pillarAnalysis/intent.ts`
- Create: `lib/services/pillarAnalysis/intent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis/intent.test.ts
import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intent';

describe('classifyIntent', () => {
  it('"How to become a nurse" → informational', () => {
    const r = classifyIntent({
      title: 'How to Become a Registered Nurse',
      h1: 'How to Become an RN',
      url: 'https://example.edu/blog/how-to-become-rn',
      pageType: 'blog',
      schemaTypes: [],
    });
    expect(r.intentClass).toBe('informational');
    expect(r.intentConfidence).toBeGreaterThan(0.7);
  });

  it('"Best nursing schools" → commercial', () => {
    const r = classifyIntent({
      title: 'Best Nursing Schools in California',
      h1: 'Top Nursing Programs',
      url: 'https://example.edu/blog/best-nursing-schools',
      pageType: 'blog',
      schemaTypes: [],
    });
    expect(r.intentClass).toBe('commercial');
  });

  it('"Apply now" program page → transactional', () => {
    const r = classifyIntent({
      title: 'BSN Program — Apply Now',
      h1: 'Bachelor of Science in Nursing',
      url: 'https://example.edu/programs/bsn',
      pageType: 'program',
      schemaTypes: ['EducationalOccupationalProgram'],
    });
    expect(r.intentClass).toBe('transactional');
  });

  it('Default by pageType: blog → informational when no rules fire', () => {
    const r = classifyIntent({
      title: 'Nursing Stories',
      h1: 'Stories',
      url: 'https://example.edu/blog/stories',
      pageType: 'blog',
      schemaTypes: [],
    });
    expect(r.intentClass).toBe('informational');
  });

  it('Default by pageType: nav → navigational', () => {
    const r = classifyIntent({
      title: 'About Us',
      h1: 'About',
      url: 'https://example.edu/about',
      pageType: 'nav',
      schemaTypes: [],
    });
    expect(r.intentClass).toBe('navigational');
  });

  it('Conflicting signals → lower confidence', () => {
    // "best" suggests commercial; "how to" suggests informational
    const r = classifyIntent({
      title: 'How to Find the Best Nursing School',
      h1: 'Finding the Best School',
      url: 'https://example.edu/blog/find-school',
      pageType: 'blog',
      schemaTypes: [],
    });
    expect(r.intentConfidence).toBeLessThan(0.7);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/intent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/pillarAnalysis/intent.ts
import type { IntentClass, PageType } from './types';

export interface IntentInput {
  title: string | null;
  h1: string | null;
  url: string;
  pageType: PageType;
  schemaTypes: string[];
}

export interface IntentResult {
  intentClass: IntentClass;
  intentConfidence: number;
}

const INFORMATIONAL_PATTERNS = [
  /\bhow to\b/i,
  /\bwhat is\b/i,
  /\bguide\b/i,
  /\btips\b/i,
  /\b(vs\.?|versus)\b/i,
  /\bexamples?\b/i,
  /\?\s*$/,
];

const COMMERCIAL_PATTERNS = [
  /\bbest\b/i,
  /\btop\s*\d*\b/i,
  /\breview\b/i,
  /\bcost of\b/i,
  /\bpricing\b/i,
];

const TRANSACTIONAL_PATTERNS = [
  /\bapply\b/i,
  /\benroll\b/i,
  /\bregister\b/i,
];

const TRANSACTIONAL_SCHEMAS = ['Course', 'EducationalOccupationalProgram'];

export function classifyIntent(input: IntentInput): IntentResult {
  const text = `${input.title || ''} ${input.h1 || ''}`;

  let infoHits = 0;
  let commHits = 0;
  let transHits = 0;

  for (const p of INFORMATIONAL_PATTERNS) if (p.test(text)) infoHits++;
  for (const p of COMMERCIAL_PATTERNS) if (p.test(text)) commHits++;
  for (const p of TRANSACTIONAL_PATTERNS) if (p.test(text)) transHits++;

  // Schema gives a strong transactional boost on program-like pages
  if (input.schemaTypes.some((s) => TRANSACTIONAL_SCHEMAS.includes(s))) {
    transHits += 2;
  }
  if (input.pageType === 'program') {
    transHits += 1;
  }

  const totalHits = infoHits + commHits + transHits;

  // No rules fired → fall back to pageType default
  if (totalHits === 0) {
    return { ...defaultByPageType(input.pageType), intentConfidence: 0.5 };
  }

  // Pick the winning class
  const hits = { informational: infoHits, commercial: commHits, transactional: transHits };
  const winner = (Object.keys(hits) as Array<keyof typeof hits>)
    .reduce((a, b) => (hits[a] >= hits[b] ? a : b));

  // Confidence: dominant class share, capped 0.95
  const dominantShare = hits[winner] / totalHits;
  const confidence = Math.min(0.95, 0.5 + dominantShare * 0.45);

  return { intentClass: winner as IntentClass, intentConfidence: confidence };
}

function defaultByPageType(pt: PageType): { intentClass: IntentClass } {
  switch (pt) {
    case 'program': return { intentClass: 'transactional' };
    case 'blog':
    case 'news':
    case 'resource': return { intentClass: 'informational' };
    case 'nav':
    case 'home': return { intentClass: 'navigational' };
    default: return { intentClass: 'unknown' };
  }
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/intent.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/intent.ts lib/services/pillarAnalysis/intent.test.ts
git commit -m "feat(pillar): rule-based intent classifier"
```

---

## Task 7: Embedding service (Transformers.js wrapper)

**Files:**
- Create: `lib/services/pillarAnalysis/embeddings.ts`
- Create: `lib/services/pillarAnalysis/embeddings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis/embeddings.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { embedTexts, cosineSimilarity } from './embeddings';

describe('embeddings', () => {
  beforeAll(() => {
    // Allow extra time for first model load
  }, 60_000);

  it('produces 384-dim vectors', async () => {
    const [v] = await embedTexts(['hello world']);
    expect(v).toHaveLength(384);
  }, 60_000);

  it('similar texts have higher cosine than unrelated ones', async () => {
    const [a, b, c] = await embedTexts([
      'how to become a registered nurse',
      'becoming an RN: what you need to know',
      'best pizza recipes for the weekend',
    ]);
    const simAB = cosineSimilarity(a, b);
    const simAC = cosineSimilarity(a, c);
    expect(simAB).toBeGreaterThan(simAC);
    expect(simAB).toBeGreaterThan(0.5);
  }, 60_000);

  it('cosineSimilarity returns 1.0 for identical vectors', () => {
    const v = [1, 0, 1, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/embeddings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/pillarAnalysis/embeddings.ts
// Local-only embeddings via @xenova/transformers (ONNX runtime, pure JS).
// No external API calls.
import type { Pipeline } from '@xenova/transformers';

let extractorPromise: Promise<Pipeline> | null = null;

async function getExtractor(): Promise<Pipeline> {
  if (!extractorPromise) {
    // Lazy import keeps the (~1MB) module out of any bundle that doesn't
    // actually call into the embedding service.
    const { pipeline } = await import('@xenova/transformers');
    extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as Promise<Pipeline>;
  }
  return extractorPromise;
}

/**
 * Embeds an array of strings into 384-dim mean-pooled, L2-normalized vectors.
 * Batched internally by the pipeline; safe for arrays of thousands.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  // output is a Tensor with shape [N, 384]. Convert to number[][].
  const data = Array.from(output.data as Float32Array);
  const dim = output.dims[1] as number;
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    result.push(data.slice(i * dim, (i + 1) * dim));
  }
  return result;
}

/** Cosine similarity for L2-normalized vectors is just dot product. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Test-only: drop the cached extractor (for memory or re-warm scenarios). */
export function _resetExtractorForTesting(): void {
  extractorPromise = null;
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/embeddings.test.ts`
Expected: 4 tests pass. First run is slow (~10–30s for model download); subsequent runs are fast (cached).

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/embeddings.ts lib/services/pillarAnalysis/embeddings.test.ts
git commit -m "feat(pillar): local MiniLM embedding service + cosine similarity"
```

---

## Task 8: Agglomerative clustering

**Files:**
- Create: `lib/services/pillarAnalysis/cluster.ts`
- Create: `lib/services/pillarAnalysis/cluster.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis/cluster.test.ts
import { describe, it, expect } from 'vitest';
import { agglomerativeCluster } from './cluster';

describe('agglomerativeCluster', () => {
  it('clusters 3 obviously-similar vectors together', () => {
    // Two tight groups via simple 2D vectors
    const vectors = [
      [1, 0], [0.99, 0.01], [0.98, 0.02], // cluster A
      [0, 1], [0.01, 0.99],                // cluster B
    ];
    const labels = agglomerativeCluster(vectors, 0.95);
    // First three in same cluster
    expect(labels[0]).toBe(labels[1]);
    expect(labels[1]).toBe(labels[2]);
    // Last two in same cluster
    expect(labels[3]).toBe(labels[4]);
    // Different clusters across groups
    expect(labels[0]).not.toBe(labels[3]);
  });

  it('returns -1 for singletons below threshold', () => {
    const vectors = [
      [1, 0], [0.99, 0.01], [0.98, 0.02],
      [0, 1], // alone
    ];
    const labels = agglomerativeCluster(vectors, 0.95);
    expect(labels[3]).toBe(-1);
  });

  it('handles empty input', () => {
    expect(agglomerativeCluster([], 0.5)).toEqual([]);
  });

  it('handles single vector', () => {
    expect(agglomerativeCluster([[1, 0]], 0.5)).toEqual([-1]);
  });

  it('threshold=0 puts everything in one cluster', () => {
    const vectors = [[1, 0], [0, 1], [0.5, 0.5]];
    const labels = agglomerativeCluster(vectors, 0);
    expect(new Set(labels).size).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/cluster.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/pillarAnalysis/cluster.ts
// Complete-linkage agglomerative clustering on cosine similarity.
// Returns a label per input vector. Singletons below threshold get label -1.
import { cosineSimilarity } from './embeddings';

export function agglomerativeCluster(
  vectors: number[][],
  similarityThreshold: number,
): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [-1];

  // Each point starts in its own cluster
  const cluster = new Map<number, number[]>(); // clusterId -> indices
  for (let i = 0; i < n; i++) cluster.set(i, [i]);

  // Pairwise similarity matrix (only upper triangle)
  const sim: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sim[i][j] = cosineSimilarity(vectors[i], vectors[j]);
    }
  }

  // Complete-linkage = use the MIN pairwise sim across two clusters' members
  function clusterSim(a: number[], b: number[]): number {
    let min = Infinity;
    for (const i of a) for (const j of b) {
      const s = i < j ? sim[i][j] : sim[j][i];
      if (s < min) min = s;
    }
    return min;
  }

  while (true) {
    let bestSim = -Infinity;
    let bestA = -1;
    let bestB = -1;
    const ids = Array.from(cluster.keys());
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const s = clusterSim(cluster.get(ids[i])!, cluster.get(ids[j])!);
        if (s > bestSim) {
          bestSim = s;
          bestA = ids[i];
          bestB = ids[j];
        }
      }
    }
    if (bestSim < similarityThreshold) break;

    // Merge bestB into bestA
    cluster.set(bestA, [...cluster.get(bestA)!, ...cluster.get(bestB)!]);
    cluster.delete(bestB);
  }

  // Assign labels — singletons get -1, multi-member clusters get sequential ids
  const labels = new Array<number>(n).fill(-1);
  let nextId = 0;
  for (const members of cluster.values()) {
    if (members.length < 2) continue;
    for (const idx of members) labels[idx] = nextId;
    nextId++;
  }
  return labels;
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/cluster.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/cluster.ts lib/services/pillarAnalysis/cluster.test.ts
git commit -m "feat(pillar): complete-linkage agglomerative clustering on cosine similarity"
```

---

## Task 9: URL record join (parsers → UrlRecord[])

**Files:**
- Create: `lib/services/pillarAnalysis/joinRecords.ts`
- Create: `lib/services/pillarAnalysis/joinRecords.test.ts`

This task assumes the existing parsers expose per-URL data. If they don't yet (they don't — see the existing `internal.parser.ts` `parseGscPages()` returns aggregate top-pages only), this task includes adding minimal per-URL extraction methods. We do NOT modify the existing `parse()` outputs — only add new methods that return URL-keyed maps.

- [ ] **Step 1: Write the failing test for the join function**

```ts
// lib/services/pillarAnalysis/joinRecords.test.ts
import { describe, it, expect } from 'vitest';
import { joinUrlRecords, type RawUrlData } from './joinRecords';

describe('joinUrlRecords', () => {
  it('joins all signals on URL and applies page-type + intent classification', () => {
    const internalRows: RawUrlData[] = [
      {
        url: 'https://e.edu/blog/become-rn',
        title: 'How to Become an RN',
        h1: 'How to Become an RN',
        metaDescription: 'A guide to nursing licensure.',
        firstParagraph: 'Becoming a registered nurse takes time and study.',
        wordCount: 1200,
        crawlDepth: 3,
        inlinks: 4,
        outlinks: 8,
        indexable: true,
        schemaTypes: ['BlogPosting'],
      },
      {
        url: 'https://e.edu/programs/bsn',
        title: 'BSN Program',
        h1: 'Bachelor of Science in Nursing',
        metaDescription: null,
        firstParagraph: null,
        wordCount: 800,
        crawlDepth: 1,
        inlinks: 25,
        outlinks: 12,
        indexable: true,
        schemaTypes: ['EducationalOccupationalProgram'],
      },
    ];
    const gsc = new Map([
      ['https://e.edu/blog/become-rn', { clicks: 50, impressions: 1200, ctr: 0.04, position: 8.2 }],
    ]);
    const ga4 = new Map();
    const semrush = new Map();

    const records = joinUrlRecords({ internalRows, gsc, ga4, semrush });

    expect(records).toHaveLength(2);

    const blog = records.find(r => r.url.endsWith('/become-rn'))!;
    expect(blog.pageType).toBe('blog');
    expect(blog.intentClass).toBe('informational');
    expect(blog.gscClicks).toBe(50);
    expect(blog.gscImpressions).toBe(1200);
    expect(blog.ga4Sessions).toBeNull();
    expect(blog.referringDomains).toBeNull();

    const program = records.find(r => r.url.endsWith('/bsn'))!;
    expect(program.pageType).toBe('program');
    expect(program.intentClass).toBe('transactional');
  });

  it('preserves URLs not present in optional sources', () => {
    const internalRows: RawUrlData[] = [{
      url: 'https://e.edu/blog/x',
      title: 'X', h1: 'X', metaDescription: null, firstParagraph: null,
      wordCount: 500, crawlDepth: 3, inlinks: 1, outlinks: 1, indexable: true,
      schemaTypes: [],
    }];
    const records = joinUrlRecords({
      internalRows, gsc: new Map(), ga4: new Map(), semrush: new Map(),
    });
    expect(records).toHaveLength(1);
    expect(records[0].gscClicks).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/joinRecords.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the join implementation**

```ts
// lib/services/pillarAnalysis/joinRecords.ts
import type { UrlRecord } from './types';
import { classifyPageType } from './pageType';
import { classifyIntent } from './intent';

export interface RawUrlData {
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  firstParagraph: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  inlinks: number | null;
  outlinks: number | null;
  indexable: boolean;
  schemaTypes: string[];
}

export interface GscPerUrl {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Ga4PerUrl {
  sessions: number;
  engagementRate: number;
  keyEvents: number;
}

export interface SemrushPerUrl {
  referringDomains: number;
  organicKeywords: number;
}

export interface JoinInput {
  internalRows: RawUrlData[];
  gsc: Map<string, GscPerUrl>;
  ga4: Map<string, Ga4PerUrl>;
  semrush: Map<string, SemrushPerUrl>;
}

/**
 * Joins per-URL data from all parsers, classifies page type and intent,
 * and returns a UrlRecord array. Topic clustering and verdict assignment
 * happen later (separate modules).
 */
export function joinUrlRecords(input: JoinInput): UrlRecord[] {
  return input.internalRows.map((row) => {
    const { pageType, pageTypeConfidence } = classifyPageType({
      url: row.url,
      schemaTypes: row.schemaTypes,
      crawlDepth: row.crawlDepth,
    });
    const { intentClass, intentConfidence } = classifyIntent({
      title: row.title,
      h1: row.h1,
      url: row.url,
      pageType,
      schemaTypes: row.schemaTypes,
    });

    const gsc = input.gsc.get(row.url) ?? null;
    const ga4 = input.ga4.get(row.url) ?? null;
    const sem = input.semrush.get(row.url) ?? null;

    return {
      url: row.url,
      pageType,
      pageTypeConfidence,
      title: row.title,
      h1: row.h1,
      metaDescription: row.metaDescription,
      firstParagraph: row.firstParagraph,
      wordCount: row.wordCount,
      crawlDepth: row.crawlDepth,
      inlinks: row.inlinks,
      outlinks: row.outlinks,
      indexable: row.indexable,
      gscClicks: gsc?.clicks ?? null,
      gscImpressions: gsc?.impressions ?? null,
      gscCtr: gsc?.ctr ?? null,
      gscPosition: gsc?.position ?? null,
      ga4Sessions: ga4?.sessions ?? null,
      ga4EngagementRate: ga4?.engagementRate ?? null,
      ga4KeyEvents: ga4?.keyEvents ?? null,
      referringDomains: sem?.referringDomains ?? null,
      organicKeywords: sem?.organicKeywords ?? null,
      intentClass,
      intentConfidence,
      topicClusterId: null,        // assigned later
      verdict: 'unclear',           // assigned later
      verdictConfidence: 0,
      recommendedPillar: null,
      reasoning: [],
    };
  });
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/joinRecords.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/joinRecords.ts lib/services/pillarAnalysis/joinRecords.test.ts
git commit -m "feat(pillar): join per-URL data + page-type + intent into UrlRecord"
```

---

## Task 10: Per-URL extractors on existing parsers

**Files:**
- Modify: `lib/parsers/internal.parser.ts` (add `parsePerUrlForPillar()` method)
- Create: `lib/services/pillarAnalysis/extractors.ts` (Map-builders for GSC/GA4/Semrush from existing parser outputs)
- Create: `lib/services/pillarAnalysis/extractors.test.ts`

The existing `InternalParser.parse()` returns aggregate stats. We need a method that returns the per-URL rows for the pillar service. The existing parser already iterates rows internally; this method exposes that data in the shape `joinRecords` expects.

For GSC/GA4/Semrush, existing parsers may already produce per-URL maps (`GscPageStat[]`, etc.); the extractors just adapt them.

- [ ] **Step 1: Write the failing test for the new internal-parser method**

```ts
// Add to lib/parsers/internal.parser.test.ts (existing file)
import { describe, it, expect } from 'vitest';
import { InternalParser } from './internal.parser';

describe('InternalParser.parsePerUrlForPillar', () => {
  it('returns per-URL rows with title/H1/meta/wordCount/depth/inlinks/schemaTypes', () => {
    const csv = `Address,Status Code,Indexability,Title 1,Meta Description 1,H1-1,Word Count,Crawl Depth,Inlinks,Outlinks,Content Type
https://e.edu/,200,Indexable,Home,Welcome,Welcome,100,0,50,30,text/html
https://e.edu/blog/x,200,Indexable,How to X,A guide to X,How to X,1200,3,4,8,text/html`;
    const parser = new InternalParser(csv);
    const rows = parser.parsePerUrlForPillar();
    expect(rows).toHaveLength(2);
    const blog = rows.find(r => r.url.endsWith('/blog/x'))!;
    expect(blog.title).toBe('How to X');
    expect(blog.h1).toBe('How to X');
    expect(blog.metaDescription).toBe('A guide to X');
    expect(blog.wordCount).toBe(1200);
    expect(blog.crawlDepth).toBe(3);
    expect(blog.inlinks).toBe(4);
    expect(blog.outlinks).toBe(8);
    expect(blog.indexable).toBe(true);
    expect(blog.schemaTypes).toEqual([]); // no structured-data column in this CSV
  });

  it('skips non-HTML content types', () => {
    const csv = `Address,Status Code,Indexability,Title 1,Meta Description 1,H1-1,Word Count,Crawl Depth,Inlinks,Outlinks,Content Type
https://e.edu/file.pdf,200,Indexable,,,Doc,5000,2,3,0,application/pdf`;
    const parser = new InternalParser(csv);
    const rows = parser.parsePerUrlForPillar();
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/parsers/internal.parser.test.ts`
Expected: 2 new tests fail with `parser.parsePerUrlForPillar is not a function`.

- [ ] **Step 3: Add the method to `internal.parser.ts`**

Append inside the `InternalParser` class (after the existing `parse()` method):

```ts
  /**
   * Per-URL extraction for the pillar-analysis service.
   * Returns one row per indexable HTML URL with the fields the join service needs.
   * Does NOT mutate or affect parse() output.
   */
  parsePerUrlForPillar(): Array<{
    url: string;
    title: string | null;
    h1: string | null;
    metaDescription: string | null;
    firstParagraph: string | null;
    wordCount: number | null;
    crawlDepth: number | null;
    inlinks: number | null;
    outlinks: number | null;
    indexable: boolean;
    schemaTypes: string[];
  }> {
    if (this.isEmpty) return [];

    const cols = {
      address: this.getColumn('address'),
      title: this.getColumn('title'),
      meta: this.getColumn('meta_description'),
      h1: this.getColumn('h1'),
      wordCount: this.getColumn('word_count'),
      crawlDepth: this.getColumn('crawl_depth'),
      inlinks: this.getColumn('inlinks'),
      outlinks: this.getColumn('outlinks'),
      indexability: this.getColumn('indexability'),
      contentType: this.getColumn('content_type'),
      // Optional first-paragraph extraction column (custom SF setup)
      firstParagraph: this.findColumn(['First Paragraph', 'first_paragraph', 'Intro Text']),
    };

    if (!cols.address) return [];

    const out: ReturnType<typeof this.parsePerUrlForPillar> = [];
    for (let i = 0; i < this.rowCount; i++) {
      const ct = cols.contentType ? this.getRowValue(cols.contentType, i) : null;
      const isHtml = !ct || /text\/html|application\/xhtml/i.test(String(ct));
      if (!isHtml) continue;

      const indexability = cols.indexability ? this.getRowValue(cols.indexability, i) : null;

      out.push({
        url: String(this.getRowValue(cols.address, i) || ''),
        title: cols.title ? toStringOrNull(this.getRowValue(cols.title, i)) : null,
        h1: cols.h1 ? toStringOrNull(this.getRowValue(cols.h1, i)) : null,
        metaDescription: cols.meta ? toStringOrNull(this.getRowValue(cols.meta, i)) : null,
        firstParagraph: cols.firstParagraph ? toStringOrNull(this.getRowValue(cols.firstParagraph, i)) : null,
        wordCount: cols.wordCount ? toNumberOrNull(this.getRowValue(cols.wordCount, i)) : null,
        crawlDepth: cols.crawlDepth ? toNumberOrNull(this.getRowValue(cols.crawlDepth, i)) : null,
        inlinks: cols.inlinks ? toNumberOrNull(this.getRowValue(cols.inlinks, i)) : null,
        outlinks: cols.outlinks ? toNumberOrNull(this.getRowValue(cols.outlinks, i)) : null,
        indexable: String(indexability || '').toLowerCase() === 'indexable',
        // Schema types come from a separate parser join — empty here.
        schemaTypes: [],
      });
    }
    return out;
  }
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
```

If `BaseParser` doesn't already expose `getRowValue(col, rowIdx)` and `rowCount`, add them. Inspect `lib/parsers/base.parser.ts` first; if missing, add minimal getters.

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/parsers/internal.parser.test.ts`
Expected: all tests (existing + 2 new) pass.

- [ ] **Step 5: Write the test for the GSC/GA4/Semrush extractors**

Create `lib/services/pillarAnalysis/extractors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gscMapFromParser, ga4MapFromParser, semrushMapFromParser } from './extractors';

describe('extractors', () => {
  it('builds GSC map from per-URL rows', () => {
    const rows = [
      { url: 'https://e.edu/a', clicks: 10, impressions: 200, ctr: 0.05, position: 5.2 },
      { url: 'https://e.edu/b', clicks: 3, impressions: 50, ctr: 0.06, position: 12.0 },
    ];
    const m = gscMapFromParser(rows);
    expect(m.size).toBe(2);
    expect(m.get('https://e.edu/a')!.clicks).toBe(10);
  });

  it('handles missing/null fields by skipping the row', () => {
    const rows = [
      { url: '', clicks: 10, impressions: 200, ctr: 0.05, position: 5.2 },
      { url: 'https://e.edu/x', clicks: 0, impressions: 0, ctr: 0, position: 0 },
    ];
    const m = gscMapFromParser(rows);
    expect(m.size).toBe(1); // first row dropped (empty URL)
  });

  it('builds GA4 map', () => {
    const rows = [
      { url: 'https://e.edu/a', sessions: 100, engagementRate: 0.6, keyEvents: 5 },
    ];
    expect(ga4MapFromParser(rows).get('https://e.edu/a')!.sessions).toBe(100);
  });

  it('builds Semrush map', () => {
    const rows = [
      { url: 'https://e.edu/a', referringDomains: 12, organicKeywords: 30 },
    ];
    expect(semrushMapFromParser(rows).get('https://e.edu/a')!.referringDomains).toBe(12);
  });
});
```

- [ ] **Step 6: Implement the extractors**

```ts
// lib/services/pillarAnalysis/extractors.ts
import type { GscPerUrl, Ga4PerUrl, SemrushPerUrl } from './joinRecords';

export interface RawGscRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface RawGa4Row {
  url: string;
  sessions: number;
  engagementRate: number;
  keyEvents: number;
}

export interface RawSemrushRow {
  url: string;
  referringDomains: number;
  organicKeywords: number;
}

export function gscMapFromParser(rows: RawGscRow[]): Map<string, GscPerUrl> {
  const m = new Map<string, GscPerUrl>();
  for (const r of rows) {
    if (!r.url) continue;
    m.set(r.url, {
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    });
  }
  return m;
}

export function ga4MapFromParser(rows: RawGa4Row[]): Map<string, Ga4PerUrl> {
  const m = new Map<string, Ga4PerUrl>();
  for (const r of rows) {
    if (!r.url) continue;
    m.set(r.url, {
      sessions: r.sessions,
      engagementRate: r.engagementRate,
      keyEvents: r.keyEvents,
    });
  }
  return m;
}

export function semrushMapFromParser(rows: RawSemrushRow[]): Map<string, SemrushPerUrl> {
  const m = new Map<string, SemrushPerUrl>();
  for (const r of rows) {
    if (!r.url) continue;
    m.set(r.url, {
      referringDomains: r.referringDomains,
      organicKeywords: r.organicKeywords,
    });
  }
  return m;
}
```

- [ ] **Step 7: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/extractors.test.ts lib/parsers/internal.parser.test.ts`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/parsers/internal.parser.ts lib/parsers/internal.parser.test.ts lib/services/pillarAnalysis/extractors.ts lib/services/pillarAnalysis/extractors.test.ts
git commit -m "feat(pillar): per-URL extractors on InternalParser + GSC/GA4/Semrush map builders"
```

---

## Task 11: Verdict logic

**Files:**
- Create: `lib/services/pillarAnalysis/verdict.ts`
- Create: `lib/services/pillarAnalysis/verdict.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis/verdict.test.ts
import { describe, it, expect } from 'vitest';
import { assignVerdicts } from './verdict';
import type { UrlRecord } from './types';
import { DEFAULT_CONFIG } from './config';

function rec(partial: Partial<UrlRecord>): UrlRecord {
  return {
    url: 'https://e.edu/x',
    pageType: 'blog',
    pageTypeConfidence: 0.85,
    title: null, h1: null, metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 2, outlinks: 5, indexable: true,
    gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: null, verdict: 'unclear', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
    ...partial,
  };
}

describe('assignVerdicts', () => {
  it('cluster of 3+ → highest authority composite gets pillar, others cluster', () => {
    const records = [
      rec({ url: 'a', topicClusterId: 0, inlinks: 10, gscClicks: 50, referringDomains: 5 }),
      rec({ url: 'b', topicClusterId: 0, inlinks: 3, gscClicks: 5, referringDomains: 1 }),
      rec({ url: 'c', topicClusterId: 0, inlinks: 1, gscClicks: 0, referringDomains: 0 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('pillar');
    expect(records[1].verdict).toBe('cluster');
    expect(records[2].verdict).toBe('cluster');
  });

  it('singleton informational with no traffic → leave-as-blog', () => {
    const records = [
      rec({ url: 'a', topicClusterId: -1, gscClicks: null, referringDomains: null }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('leave-as-blog');
  });

  it('thin content with zero traffic + zero links → prune', () => {
    const records = [
      rec({ url: 'a', topicClusterId: -1, wordCount: 80, gscClicks: 0, referringDomains: 0, inlinks: 0 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('prune');
  });

  it('commercial-intent in a cluster → leave-as-blog (does not fit cluster model)', () => {
    const records = [
      rec({ url: 'a', topicClusterId: 0, intentClass: 'commercial', inlinks: 5 }),
      rec({ url: 'b', topicClusterId: 0, inlinks: 4 }),
      rec({ url: 'c', topicClusterId: 0, inlinks: 3 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('leave-as-blog');
  });

  it('singleton with strong authority → leave-as-blog', () => {
    const records = [
      rec({ url: 'a', topicClusterId: -1, gscClicks: 500, referringDomains: 12 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('leave-as-blog');
  });

  it('non-blog/news/resource URLs receive unclear verdict (out of scope)', () => {
    const records = [
      rec({ url: 'a', pageType: 'program' }),
      rec({ url: 'b', pageType: 'nav' }),
      rec({ url: 'c', pageType: 'home' }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    for (const r of records) expect(r.verdict).toBe('unclear');
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/verdict.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/pillarAnalysis/verdict.ts
import type { UrlRecord } from './types';
import type { PillarConfig } from './config';

const SCOPE_PAGE_TYPES = new Set(['blog', 'news', 'resource']);
const STRONG_AUTHORITY_GSC = 100;
const STRONG_AUTHORITY_RD = 5;

export function assignVerdicts(records: UrlRecord[], cfg: PillarConfig): void {
  // 1. Out-of-scope page types: stay 'unclear'
  for (const r of records) {
    if (!SCOPE_PAGE_TYPES.has(r.pageType)) {
      r.verdict = 'unclear';
      r.verdictConfidence = 1.0;
      r.reasoning = [`pageType=${r.pageType} (out of scope for pillar conversion)`];
    }
  }

  // 2. Group by cluster
  const byCluster = new Map<number, UrlRecord[]>();
  for (const r of records) {
    if (!SCOPE_PAGE_TYPES.has(r.pageType)) continue;
    const k = r.topicClusterId ?? -1;
    const arr = byCluster.get(k) ?? [];
    arr.push(r);
    byCluster.set(k, arr);
  }

  for (const [clusterId, members] of byCluster.entries()) {
    if (clusterId === -1) {
      // Singletons → leave-as-blog or prune
      for (const r of members) classifySingleton(r, cfg);
      continue;
    }

    // Filter informational members for pillar selection
    const informational = members.filter((m) => m.intentClass === 'informational');
    const commercials = members.filter((m) => m.intentClass !== 'informational');

    // Commercial members in a cluster → leave-as-blog
    for (const r of commercials) {
      r.verdict = 'leave-as-blog';
      r.verdictConfidence = 0.8;
      r.reasoning = ['intent is non-informational; would not fit cluster model'];
    }

    if (informational.length < cfg.minClusterSize) {
      // Cluster too small after filtering → all become singletons
      for (const r of informational) classifySingleton(r, cfg);
      continue;
    }

    // Pick pillar: highest authority composite rank
    const pillar = pickPillar(informational);
    pillar.verdict = 'pillar';
    pillar.verdictConfidence = 0.8;
    pillar.reasoning = [
      `cluster size ${informational.length}`,
      `highest authority composite (inlinks=${pillar.inlinks ?? 0}, gscClicks=${pillar.gscClicks ?? 0}, referringDomains=${pillar.referringDomains ?? 0})`,
    ];

    for (const r of informational) {
      if (r === pillar) continue;
      r.verdict = 'cluster';
      r.verdictConfidence = 0.75;
      r.recommendedPillar = pillar.url;
      r.reasoning = [`cluster member of "${pillar.url}"`];
    }
  }
}

function classifySingleton(r: UrlRecord, cfg: PillarConfig): void {
  const wc = r.wordCount ?? 0;
  const clicks = r.gscClicks ?? 0;
  const rd = r.referringDomains ?? 0;
  const inlinks = r.inlinks ?? 0;

  // Prune: very thin OR (zero traffic AND zero links)
  if (wc < cfg.pruneMaxWords || (clicks === 0 && rd === 0 && inlinks === 0 && wc < cfg.thinContentMaxWords)) {
    r.verdict = 'prune';
    r.verdictConfidence = 0.7;
    r.reasoning = [`thin (wordCount=${wc}) and no signals (clicks=${clicks}, rd=${rd}, inlinks=${inlinks})`];
    return;
  }

  // Default singleton → leave-as-blog
  r.verdict = 'leave-as-blog';
  if (clicks >= STRONG_AUTHORITY_GSC || rd >= STRONG_AUTHORITY_RD) {
    r.verdictConfidence = 0.85;
    r.reasoning = [`singleton with standalone authority (clicks=${clicks}, rd=${rd})`];
  } else {
    r.verdictConfidence = 0.6;
    r.reasoning = ['singleton (no cluster) with no near-duplicate'];
  }
}

function pickPillar(members: UrlRecord[]): UrlRecord {
  // Rank within cluster on each signal (1 = highest); missing signals contribute 0.
  const rankedSum = members.map((m, i) => ({ idx: i, score: 0, m }));
  for (const field of ['inlinks', 'gscClicks', 'referringDomains'] as const) {
    const present = members.filter((m) => m[field] != null);
    if (present.length === 0) continue;
    // Sort descending; position determines rank-score
    const sorted = [...members].sort((a, b) => (b[field] ?? -1) - (a[field] ?? -1));
    sorted.forEach((m, rank) => {
      if (m[field] == null) return;
      const score = present.length - rank; // higher = better
      const target = rankedSum.find((x) => x.m === m)!;
      target.score += score;
    });
  }
  // Tiebreak on word count
  rankedSum.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.m.wordCount ?? 0) - (a.m.wordCount ?? 0);
  });
  return rankedSum[0].m;
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/verdict.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/verdict.ts lib/services/pillarAnalysis/verdict.test.ts
git commit -m "feat(pillar): rank-based verdict assignment (5 buckets + unclear)"
```

---

## Task 12: Site fit score (six subscores + composite)

**Files:**
- Create: `lib/services/pillarAnalysis/score.ts`
- Create: `lib/services/pillarAnalysis/score.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis/score.test.ts
import { describe, it, expect } from 'vitest';
import { computeFitScore } from './score';
import type { UrlRecord } from './types';
import { DEFAULT_CONFIG } from './config';

function infoBlog(extras: Partial<UrlRecord> = {}): UrlRecord {
  return {
    url: 'https://e.edu/blog/' + Math.random().toString(36).slice(2, 8),
    pageType: 'blog',
    pageTypeConfidence: 0.85,
    title: 't', h1: 'h', metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 3, outlinks: 5, indexable: true,
    gscClicks: 0, gscImpressions: 0, gscCtr: 0, gscPosition: 0,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: 0, verdict: 'unclear', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
    ...extras,
  };
}

describe('computeFitScore', () => {
  it('thin site (5 posts, no clusters, no GSC) scores low', () => {
    const records = Array.from({ length: 5 }, () => infoBlog({ topicClusterId: -1 }));
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(r.score).toBeLessThanOrEqual(4);
    expect(r.dataCompleteness).toBeLessThan(1.0);
  });

  it('rich site (60 posts, 5 clusters, GSC + backlinks) scores high', () => {
    const records: UrlRecord[] = [];
    for (let cluster = 0; cluster < 5; cluster++) {
      for (let i = 0; i < 12; i++) {
        records.push(infoBlog({
          topicClusterId: cluster,
          gscImpressions: 500,
          referringDomains: 1,
          inlinks: 5,
        }));
      }
    }
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(r.score).toBeGreaterThanOrEqual(7);
    expect(r.dataCompleteness).toBeCloseTo(1.0, 1);
  });

  it('all subscores between 0 and 10', () => {
    const records = Array.from({ length: 30 }, () => infoBlog());
    const r = computeFitScore(records, DEFAULT_CONFIG);
    for (const v of Object.values(r.subscores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
    expect(r.score).toBeGreaterThanOrEqual(1);
    expect(r.score).toBeLessThanOrEqual(10);
  });

  it('dataCompleteness reflects which subscores had real input', () => {
    // 30 posts, no GSC, no Semrush — 2 of 6 subscores rely heavily on those
    const records = Array.from({ length: 30 }, () => infoBlog({
      gscImpressions: null,
      gscClicks: null,
      referringDomains: null,
    }));
    const r = computeFitScore(records, DEFAULT_CONFIG);
    expect(r.dataCompleteness).toBeLessThan(1.0);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/score.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/pillarAnalysis/score.ts
import type { UrlRecord, SubscoreBreakdown } from './types';
import type { PillarConfig } from './config';

export interface FitScoreResult {
  score: number;             // 1-10
  subscores: SubscoreBreakdown;
  dataCompleteness: number;  // 0.0-1.0
}

export function computeFitScore(records: UrlRecord[], cfg: PillarConfig): FitScoreResult {
  const informational = records.filter(
    (r) => r.intentClass === 'informational' && (r.pageType === 'blog' || r.pageType === 'news' || r.pageType === 'resource'),
  );
  const programs = records.filter((r) => r.pageType === 'program');

  const subs: SubscoreBreakdown = {
    contentVolume: contentVolumeScore(informational.length),
    topicalConcentration: topicalConcentrationScore(informational, cfg),
    organicFootprint: organicFootprintScore(informational),
    internalLinkGap: internalLinkGapScore(informational),
    programPageClarity: programPageClarityScore(programs),
    backlinkDistribution: backlinkDistributionScore(informational),
  };

  // Data-completeness audit: which subscores had real signal vs. neutral default?
  const signalsPresent: Record<keyof SubscoreBreakdown, boolean> = {
    contentVolume: true,                                        // always present
    topicalConcentration: informational.length > 0,
    organicFootprint: informational.some((r) => r.gscImpressions != null),
    internalLinkGap: informational.some((r) => r.inlinks != null),
    programPageClarity: programs.length > 0,
    backlinkDistribution: informational.some((r) => r.referringDomains != null),
  };
  const presentCount = Object.values(signalsPresent).filter(Boolean).length;
  const dataCompleteness = presentCount / 6;

  // Substitute neutral 5.0 where signal is absent
  for (const k of Object.keys(signalsPresent) as Array<keyof SubscoreBreakdown>) {
    if (!signalsPresent[k]) subs[k] = 5;
  }

  const w = cfg.subscoreWeights;
  const composite =
    subs.contentVolume * w.contentVolume +
    subs.topicalConcentration * w.topicalConcentration +
    subs.organicFootprint * w.organicFootprint +
    subs.internalLinkGap * w.internalLinkGap +
    subs.programPageClarity * w.programPageClarity +
    subs.backlinkDistribution * w.backlinkDistribution;

  // Round to 1-10 integer
  const score = Math.max(1, Math.min(10, Math.round(composite)));

  return { score, subscores: subs, dataCompleteness };
}

function contentVolumeScore(n: number): number {
  // 0 at <15, 10 at >=100, linear in between
  if (n < 15) return 0;
  if (n >= 100) return 10;
  return ((n - 15) / 85) * 10;
}

function topicalConcentrationScore(records: UrlRecord[], cfg: PillarConfig): number {
  if (records.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const r of records) {
    if (r.topicClusterId == null || r.topicClusterId < 0) continue;
    counts.set(r.topicClusterId, (counts.get(r.topicClusterId) ?? 0) + 1);
  }
  const validClusters = Array.from(counts.values()).filter((c) => c >= cfg.minClusterSize).length;
  if (validClusters === 0) return 0;
  if (validClusters >= 5 && validClusters <= 8) return 10;
  if (validClusters < 5) return (validClusters / 5) * 10;
  // Over-fragmentation penalty: linear decay from 10 at 8 to 5 at 14+
  if (validClusters >= 14) return 5;
  return 10 - ((validClusters - 8) / 6) * 5;
}

function organicFootprintScore(records: UrlRecord[]): number {
  const hasData = records.some((r) => r.gscImpressions != null);
  if (!hasData) return 5; // neutral; will be flagged via dataCompleteness anyway
  const totalImpressions = records.reduce((acc, r) => acc + (r.gscImpressions ?? 0), 0);
  // Log-scale: 0 impressions → 0, 100k → 10
  return Math.max(0, Math.min(10, Math.log10(totalImpressions + 1) * 2));
}

function internalLinkGapScore(records: UrlRecord[]): number {
  if (records.length === 0) return 0;
  // Crude proxy: lower avg inlinks → higher gap → higher opportunity score
  const avgInlinks = records.reduce((a, r) => a + (r.inlinks ?? 0), 0) / records.length;
  // 0 inlinks → 10 (max gap), 10+ inlinks → 0 (no gap)
  return Math.max(0, Math.min(10, 10 - avgInlinks));
}

function programPageClarityScore(programs: UrlRecord[]): number {
  if (programs.length === 0) return 0;
  // Mean intent confidence on programs that classified as transactional
  const trans = programs.filter((p) => p.intentClass === 'transactional');
  if (trans.length === 0) return 2; // programs exist but none classified transactional
  const avgConf = trans.reduce((a, p) => a + p.intentConfidence, 0) / trans.length;
  return Math.round(avgConf * 10);
}

function backlinkDistributionScore(records: UrlRecord[]): number {
  const withRD = records.filter((r) => r.referringDomains != null);
  if (withRD.length === 0) return 5;
  const values = withRD.map((r) => r.referringDomains!);
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  // Higher CV = more uneven distribution = more consolidation opportunity
  return Math.max(0, Math.min(10, cv * 5));
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/score.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/score.ts lib/services/pillarAnalysis/score.test.ts
git commit -m "feat(pillar): six-subscore site fit score with dataCompleteness tracking"
```

---

## Task 13: Hub-format decision tree

**Files:**
- Create: `lib/services/pillarAnalysis/hubDecision.ts`
- Create: `lib/services/pillarAnalysis/hubDecision.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis/hubDecision.test.ts
import { describe, it, expect } from 'vitest';
import { decideHubFormat } from './hubDecision';
import { DEFAULT_CONFIG } from './config';
import type { UrlRecord } from './types';

function urlRec(p: Partial<UrlRecord>): UrlRecord {
  return {
    url: 'https://e.edu/x', pageType: 'blog', pageTypeConfidence: 0.85,
    title: null, h1: null, metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 3, outlinks: 5, indexable: true,
    gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: 0, verdict: 'unclear', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
    ...p,
  };
}

describe('decideHubFormat', () => {
  it('mostly vertical clusters + program pages have informational impressions → nest under programs', () => {
    const records: UrlRecord[] = [
      urlRec({ pageType: 'program', topicClusterId: null, gscImpressions: 500 }),
      urlRec({ topicClusterId: 0, gscImpressions: 100 }),
      urlRec({ topicClusterId: 0, gscImpressions: 100 }),
      urlRec({ topicClusterId: 0, gscImpressions: 100 }),
    ];
    const verticality = new Map([[0, 0.8]]); // cluster 0 is vertical
    const r = decideHubFormat(records, verticality, DEFAULT_CONFIG);
    expect(r.primary).toBe('nest-under-programs');
  });

  it('career-guides keyword pattern in cluster names → fresh-career-guides-hub', () => {
    const records: UrlRecord[] = [
      urlRec({ topicClusterId: 0, title: 'How to Become an RN', h1: 'How to Become an RN' }),
      urlRec({ topicClusterId: 0, title: 'Salary for Nurses', h1: 'Nursing Salary' }),
      urlRec({ topicClusterId: 0, title: 'Career Paths in Nursing', h1: 'Nursing Careers' }),
    ];
    const verticality = new Map([[0, 0.3]]); // horizontal
    const r = decideHubFormat(records, verticality, DEFAULT_CONFIG);
    expect(r.primary).toBe('fresh-career-guides-hub');
  });

  it('returns alternates with score deltas', () => {
    const records: UrlRecord[] = [
      urlRec({ topicClusterId: 0 }),
      urlRec({ topicClusterId: 0 }),
      urlRec({ topicClusterId: 0 }),
    ];
    const verticality = new Map([[0, 0.5]]);
    const r = decideHubFormat(records, verticality, DEFAULT_CONFIG);
    expect(r.alternates.length).toBeGreaterThanOrEqual(1);
    for (const a of r.alternates) {
      expect(typeof a.scoreDelta).toBe('number');
    }
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/hubDecision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/pillarAnalysis/hubDecision.ts
import type { UrlRecord, HubFormat, HubRecommendation } from './types';
import type { PillarConfig } from './config';

const CAREER_GUIDE_PATTERNS = [
  /\bcareer\b/i,
  /\bsalary\b/i,
  /\bhow to become\b/i,
  /\bjobs? for\b/i,
];

interface FormatScore {
  format: HubFormat;
  score: number;
  reasoning: string[];
}

export function decideHubFormat(
  records: UrlRecord[],
  clusterVerticality: Map<number, number>, // clusterId → cosine to closest program
  cfg: PillarConfig,
): HubRecommendation {
  const programs = records.filter((r) => r.pageType === 'program');
  const programsHaveInfoImpressions = programs.some(
    (p) => (p.gscImpressions ?? 0) > 0,
  );

  const clusters = Array.from(clusterVerticality.keys());
  const vertical = clusters.filter(
    (c) => (clusterVerticality.get(c) ?? 0) >= cfg.verticalAlignmentThreshold,
  );
  const horizontal = clusters.filter(
    (c) => (clusterVerticality.get(c) ?? 0) < cfg.verticalAlignmentThreshold,
  );
  const verticalShare = clusters.length === 0 ? 0 : vertical.length / clusters.length;

  // Detect career-guide intent in cluster member titles/H1s
  const horizontalRecords = records.filter(
    (r) => r.topicClusterId != null && horizontal.includes(r.topicClusterId),
  );
  const careerGuideyHits = horizontalRecords.filter((r) => {
    const text = `${r.title || ''} ${r.h1 || ''}`;
    return CAREER_GUIDE_PATTERNS.some((p) => p.test(text));
  }).length;
  const careerGuideyRatio = horizontalRecords.length === 0
    ? 0
    : careerGuideyHits / horizontalRecords.length;

  const candidates: FormatScore[] = [
    {
      format: 'nest-under-programs',
      score: verticalShare * 6 + (programsHaveInfoImpressions ? 4 : 0),
      reasoning: [
        `${Math.round(verticalShare * 100)}% of clusters are program-aligned`,
        programsHaveInfoImpressions
          ? 'program pages already pull informational impressions'
          : 'program pages do not currently rank for informational queries',
      ],
    },
    {
      format: 'hybrid',
      score: clusters.length === 0 ? 0 : (1 - Math.abs(verticalShare - 0.5)) * 8 + 1,
      reasoning: [
        `vertical/horizontal split ratio is ${Math.round(verticalShare * 100)}/${Math.round((1 - verticalShare) * 100)}`,
        'mixed split favors per-cluster routing',
      ],
    },
    {
      format: 'rename-blog-to-resources',
      score: (1 - verticalShare) * 4 + (hasBlogBacklinkAuthority(records) ? 3 : 0),
      reasoning: [
        `${Math.round((1 - verticalShare) * 100)}% horizontal clusters argue for a non-program hub`,
        hasBlogBacklinkAuthority(records)
          ? 'existing /blog/ has backlink authority worth preserving'
          : 'no significant blog backlink authority',
      ],
    },
    {
      format: 'fresh-career-guides-hub',
      score: careerGuideyRatio * 9,
      reasoning: [
        `${Math.round(careerGuideyRatio * 100)}% of horizontal cluster pages match career-guide keyword patterns`,
      ],
    },
    {
      format: 'fresh-resources-hub',
      score: (1 - verticalShare) * 3,
      reasoning: ['horizontal clusters with no other strong signal'],
    },
  ];

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  const alternates = candidates
    .slice(1)
    .map((c) => ({ format: c.format, scoreDelta: winner.score - c.score }));

  return {
    primary: winner.format,
    alternates,
    reasoning: winner.reasoning,
  };
}

function hasBlogBacklinkAuthority(records: UrlRecord[]): boolean {
  const blogRecs = records.filter(
    (r) => r.pageType === 'blog' && r.url.includes('/blog/'),
  );
  const totalRD = blogRecs.reduce((a, r) => a + (r.referringDomains ?? 0), 0);
  return totalRD >= 10;
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/hubDecision.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/hubDecision.ts lib/services/pillarAnalysis/hubDecision.test.ts
git commit -m "feat(pillar): hub-format decision tree with scored alternates"
```

---

## Task 14: Cluster-vertical alignment helper

**Files:**
- Create: `lib/services/pillarAnalysis/verticality.ts`
- Create: `lib/services/pillarAnalysis/verticality.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis/verticality.test.ts
import { describe, it, expect } from 'vitest';
import { computeClusterVerticality } from './verticality';
import type { UrlRecord } from './types';

function rec(p: Partial<UrlRecord>): UrlRecord {
  return {
    url: 'https://e.edu/x', pageType: 'blog', pageTypeConfidence: 0.85,
    title: null, h1: null, metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 3, outlinks: 5, indexable: true,
    gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: null, verdict: 'unclear', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
    ...p,
  };
}

describe('computeClusterVerticality', () => {
  it('cluster centroid close to a program centroid → high verticality', () => {
    // Identical vectors for cluster members and the program → cosine = 1
    const records = [
      rec({ url: 'p', pageType: 'program', topicClusterId: null }),
      rec({ url: 'a', topicClusterId: 0 }),
      rec({ url: 'b', topicClusterId: 0 }),
    ];
    const vectors = new Map([
      ['p', [1, 0, 0]],
      ['a', [1, 0, 0]],
      ['b', [1, 0, 0]],
    ]);
    const m = computeClusterVerticality(records, vectors);
    expect(m.get(0)).toBeCloseTo(1.0, 5);
  });

  it('cluster orthogonal to all programs → 0 verticality', () => {
    const records = [
      rec({ url: 'p', pageType: 'program' }),
      rec({ url: 'a', topicClusterId: 0 }),
      rec({ url: 'b', topicClusterId: 0 }),
    ];
    const vectors = new Map([
      ['p', [1, 0]],
      ['a', [0, 1]],
      ['b', [0, 1]],
    ]);
    expect(computeClusterVerticality(records, vectors).get(0)).toBeCloseTo(0, 5);
  });

  it('returns empty map when no clusters or no programs', () => {
    expect(computeClusterVerticality([], new Map()).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/verticality.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/pillarAnalysis/verticality.ts
import type { UrlRecord } from './types';
import { cosineSimilarity } from './embeddings';

/**
 * For each cluster, compute the maximum cosine similarity between the
 * cluster's centroid and any program-page vector. Higher = more program-aligned.
 */
export function computeClusterVerticality(
  records: UrlRecord[],
  vectorsByUrl: Map<string, number[]>,
): Map<number, number> {
  const result = new Map<number, number>();

  // Group cluster members
  const clusters = new Map<number, UrlRecord[]>();
  for (const r of records) {
    if (r.topicClusterId == null || r.topicClusterId < 0) continue;
    const arr = clusters.get(r.topicClusterId) ?? [];
    arr.push(r);
    clusters.set(r.topicClusterId, arr);
  }

  const programVectors = records
    .filter((r) => r.pageType === 'program')
    .map((r) => vectorsByUrl.get(r.url))
    .filter((v): v is number[] => v != null);

  if (programVectors.length === 0) {
    for (const id of clusters.keys()) result.set(id, 0);
    return result;
  }

  for (const [clusterId, members] of clusters.entries()) {
    const memberVectors = members
      .map((m) => vectorsByUrl.get(m.url))
      .filter((v): v is number[] => v != null);
    if (memberVectors.length === 0) {
      result.set(clusterId, 0);
      continue;
    }
    const centroid = meanVector(memberVectors);
    let best = -Infinity;
    for (const pv of programVectors) {
      const s = cosineSimilarity(centroid, pv);
      if (s > best) best = s;
    }
    result.set(clusterId, Math.max(0, best));
  }

  return result;
}

function meanVector(vs: number[][]): number[] {
  const dim = vs[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vs) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vs.length;
  return out;
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/verticality.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/verticality.ts lib/services/pillarAnalysis/verticality.test.ts
git commit -m "feat(pillar): cluster verticality (cosine of centroid to nearest program)"
```

---

## Task 15: Pillar topic naming

**Files:**
- Create: `lib/services/pillarAnalysis/topicNaming.ts`
- Create: `lib/services/pillarAnalysis/topicNaming.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis/topicNaming.test.ts
import { describe, it, expect } from 'vitest';
import { nameClusters } from './topicNaming';
import type { UrlRecord } from './types';

function rec(title: string, h1: string, clusterId: number): UrlRecord {
  return {
    url: 'https://e.edu/' + title.toLowerCase().replace(/\W+/g, '-'),
    pageType: 'blog', pageTypeConfidence: 0.85,
    title, h1, metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 3, outlinks: 5, indexable: true,
    gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: clusterId, verdict: 'unclear', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
  };
}

describe('nameClusters', () => {
  it('picks top-frequency content terms as the cluster name', () => {
    const recs = [
      rec('Practical Nursing Career Paths', 'Nursing Careers', 0),
      rec('Practical Nursing Salary Guide', 'Nursing Salary', 0),
      rec('Practical Nursing Certification', 'Nursing Certification', 0),
    ];
    const names = nameClusters(recs);
    expect(names.get(0)).toMatch(/nursing/i);
  });

  it('skips stopwords and very short tokens', () => {
    const recs = [
      rec('The Best of It', 'A Guide', 0),
      rec('How to Do It Better', 'Better', 0),
      rec('Doing It With Style', 'Style', 0),
    ];
    const names = nameClusters(recs);
    const name = names.get(0)!;
    expect(name).not.toMatch(/^(the|of|a|to|in|with)$/i);
  });

  it('returns empty map for no clusters', () => {
    expect(nameClusters([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis/topicNaming.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/pillarAnalysis/topicNaming.ts
import type { UrlRecord } from './types';

const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','for','to','in','on','at','by','with','from','as','is','are','was','were','be','been','being','it','this','that','these','those','your','our','their','his','her','its','do','does','did','doing','have','has','had','having','will','would','should','could','can','may','might','must','i','you','he','she','we','they','what','which','who','whom','how','why','when','where','about','into','through','during','before','after','above','below','between','among','than','also','more','most','some','any','all','each','every','no','not','only','same','so','than','too','very','just','off','out','over','under','again','further','then','once','here','there','up','down','if','because','while','until','since','though','although','unless','whether','near','within','without','among','via','plus','even','let','says','said','get','got','vs','versus','best','top','review','tips','guide','guides','how','what','why','when','where',
]);

export function nameClusters(records: UrlRecord[]): Map<number, string> {
  const out = new Map<number, string>();
  const byCluster = new Map<number, UrlRecord[]>();
  for (const r of records) {
    if (r.topicClusterId == null || r.topicClusterId < 0) continue;
    const arr = byCluster.get(r.topicClusterId) ?? [];
    arr.push(r);
    byCluster.set(r.topicClusterId, arr);
  }

  for (const [id, members] of byCluster.entries()) {
    const counts = new Map<string, number>();
    for (const m of members) {
      const tokens = tokenize(`${m.title || ''} ${m.h1 || ''}`);
      for (const t of tokens) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 3).map(([t]) => t);
    if (top.length === 0) {
      out.set(id, `Cluster ${id + 1}`);
      continue;
    }
    out.set(id, top.map(capitalize).join(' '));
  }
  return out;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis/topicNaming.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis/topicNaming.ts lib/services/pillarAnalysis/topicNaming.test.ts
git commit -m "feat(pillar): top-frequency cluster naming"
```

---

## Task 16: Main orchestrator

**Files:**
- Create: `lib/services/pillarAnalysis.service.ts`
- Create: `lib/services/pillarAnalysis.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/services/pillarAnalysis.service.test.ts
import { describe, it, expect } from 'vitest';
import { runPillarAnalysisFromInputs } from './pillarAnalysis.service';
import type { RawUrlData } from './pillarAnalysis/joinRecords';

describe('runPillarAnalysisFromInputs', () => {
  it('produces score, hub recommendation, and per-URL verdicts end-to-end', async () => {
    const internalRows: RawUrlData[] = [
      // 4 cluster of "nursing" posts
      { url: 'https://e.edu/blog/become-rn', title: 'How to Become an RN', h1: 'Become an RN', metaDescription: 'Guide to nursing.', firstParagraph: 'Becoming a registered nurse takes study and licensure.', wordCount: 1500, crawlDepth: 3, inlinks: 8, outlinks: 5, indexable: true, schemaTypes: [] },
      { url: 'https://e.edu/blog/rn-salary', title: 'RN Salary Guide', h1: 'Nursing Salary', metaDescription: 'How much RNs earn.', firstParagraph: 'Registered nurses earn varying amounts by state and specialty.', wordCount: 1100, crawlDepth: 3, inlinks: 4, outlinks: 5, indexable: true, schemaTypes: [] },
      { url: 'https://e.edu/blog/nursing-school-tips', title: 'Nursing School Tips', h1: 'Tips for Nursing Students', metaDescription: 'Survive nursing school.', firstParagraph: 'Nursing school is demanding; here are tips for studying.', wordCount: 900, crawlDepth: 3, inlinks: 2, outlinks: 5, indexable: true, schemaTypes: [] },
      // Program page
      { url: 'https://e.edu/programs/bsn', title: 'BSN Program — Apply', h1: 'Bachelor of Science in Nursing', metaDescription: null, firstParagraph: 'Our BSN program prepares you for a nursing career.', wordCount: 800, crawlDepth: 1, inlinks: 25, outlinks: 12, indexable: true, schemaTypes: ['EducationalOccupationalProgram'] },
      // Unrelated
      { url: 'https://e.edu/blog/cooking', title: 'Cooking with Friends', h1: 'Cook Together', metaDescription: 'Fun group cooking.', firstParagraph: 'Cooking with friends builds memories around the table.', wordCount: 400, crawlDepth: 3, inlinks: 0, outlinks: 2, indexable: true, schemaTypes: [] },
    ];
    const result = await runPillarAnalysisFromInputs({
      internalRows,
      gsc: new Map(),
      ga4: new Map(),
      semrush: new Map(),
    });
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.urlVerdicts.length).toBe(internalRows.length);
    // The 3 nursing posts should cluster together
    const nursingClusterIds = result.urlVerdicts
      .filter(r => /nursing|rn|bsn/i.test(r.title || ''))
      .map(r => r.topicClusterId)
      .filter((c): c is number => c != null && c >= 0);
    expect(new Set(nursingClusterIds).size).toBeLessThanOrEqual(2); // mostly one cluster
    expect(result.hubRecommendation.primary).toBeDefined();
    expect(result.hubRecommendation.alternates.length).toBeGreaterThan(0);
  }, 60_000); // long timeout for first model load
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run lib/services/pillarAnalysis.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the orchestrator**

```ts
// lib/services/pillarAnalysis.service.ts
import { joinUrlRecords, type JoinInput } from './pillarAnalysis/joinRecords';
import { embedTexts } from './pillarAnalysis/embeddings';
import { agglomerativeCluster } from './pillarAnalysis/cluster';
import { computeClusterVerticality } from './pillarAnalysis/verticality';
import { nameClusters } from './pillarAnalysis/topicNaming';
import { decideHubFormat } from './pillarAnalysis/hubDecision';
import { assignVerdicts } from './pillarAnalysis/verdict';
import { computeFitScore } from './pillarAnalysis/score';
import { mergeConfig, DEFAULT_CONFIG, type PillarConfig } from './pillarAnalysis/config';
import type { PillarAnalysisResult, PillarTopic, UrlRecord } from './pillarAnalysis/types';

export interface RunInput extends JoinInput {
  configOverrides?: Partial<PillarConfig>;
}

/**
 * The full deterministic pipeline:
 *   parsers → join → embed → cluster → verticality → name → score/hub/verdict
 * No external API calls; embeddings run locally via Transformers.js.
 */
export async function runPillarAnalysisFromInputs(input: RunInput): Promise<PillarAnalysisResult> {
  const cfg = mergeConfig(input.configOverrides ?? {});

  // 1. Join per-URL records (already classifies pageType + intent)
  const records: UrlRecord[] = joinUrlRecords(input);

  // 2. Embed each record's text
  const texts = records.map(buildEmbeddingText);
  const vectors = await embedTexts(texts);
  const vectorByUrl = new Map<string, number[]>();
  records.forEach((r, i) => vectorByUrl.set(r.url, vectors[i]));

  // 3. Cluster only the in-scope informational records
  const scopeIdxs: number[] = [];
  records.forEach((r, i) => {
    if (
      r.intentClass === 'informational' &&
      (r.pageType === 'blog' || r.pageType === 'news' || r.pageType === 'resource')
    ) {
      scopeIdxs.push(i);
    }
  });
  const scopeVectors = scopeIdxs.map((i) => vectors[i]);
  const labels = agglomerativeCluster(scopeVectors, cfg.clusterSimilarityThreshold);
  scopeIdxs.forEach((origIdx, scopeI) => {
    records[origIdx].topicClusterId = labels[scopeI];
  });

  // 4. Compute cluster verticality (vs program pages)
  const verticality = computeClusterVerticality(records, vectorByUrl);

  // 5. Assign verdicts
  assignVerdicts(records, cfg);

  // 6. Score the site
  const fit = computeFitScore(records, cfg);

  // 7. Hub recommendation
  const hub = decideHubFormat(records, verticality, cfg);

  // 8. Pillar topic groupings (named, with anchor URL)
  const topicNames = nameClusters(records);
  const pillarTopics = buildPillarTopics(records, topicNames);

  return {
    score: fit.score,
    subscores: fit.subscores,
    dataCompleteness: fit.dataCompleteness,
    hubRecommendation: hub,
    pillarTopics,
    urlVerdicts: records,
  };
}

function buildEmbeddingText(r: UrlRecord): string {
  return [r.title, r.h1, r.metaDescription, r.firstParagraph]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2048); // hard cap to keep embedding inference fast
}

function buildPillarTopics(records: UrlRecord[], names: Map<number, string>): PillarTopic[] {
  const byCluster = new Map<number, UrlRecord[]>();
  for (const r of records) {
    if (r.topicClusterId == null || r.topicClusterId < 0) continue;
    const arr = byCluster.get(r.topicClusterId) ?? [];
    arr.push(r);
    byCluster.set(r.topicClusterId, arr);
  }
  return Array.from(byCluster.entries()).map(([id, members]) => {
    const pillar = members.find((m) => m.verdict === 'pillar');
    return {
      clusterId: id,
      name: names.get(id) ?? `Cluster ${id + 1}`,
      pillarUrl: pillar?.url ?? null,
      clusterUrls: members.filter((m) => m.verdict === 'cluster').map((m) => m.url),
      size: members.length,
    };
  });
}

// Re-export public types for ergonomic import
export type { PillarAnalysisResult, UrlRecord } from './pillarAnalysis/types';
export { DEFAULT_CONFIG };
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run lib/services/pillarAnalysis.service.test.ts`
Expected: passes (may take 30–60s for first model load).

- [ ] **Step 5: Commit**

```bash
git add lib/services/pillarAnalysis.service.ts lib/services/pillarAnalysis.service.test.ts
git commit -m "feat(pillar): orchestrator service tying join/embed/cluster/score/verdict together"
```

---

## Task 17: API route POST /api/pillar-analysis

**Files:**
- Create: `app/api/pillar-analysis/route.ts`

- [ ] **Step 1: Write the route handler**

```ts
// app/api/pillar-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runPillarAnalysisFromInputs } from '@/lib/services/pillarAnalysis.service';
import { InternalParser } from '@/lib/parsers/internal.parser';
import { gscMapFromParser, ga4MapFromParser, semrushMapFromParser } from '@/lib/services/pillarAnalysis/extractors';

export async function POST(req: NextRequest) {
  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: 'sessionId_required' }, { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { id: body.sessionId } });
  if (!session) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  }
  if (session.status !== 'complete') {
    return NextResponse.json({ error: 'session_not_complete', status: session.status }, { status: 409 });
  }

  // Create the PillarAnalysis record in 'running' state
  const pa = await prisma.pillarAnalysis.create({
    data: { sessionId: body.sessionId, status: 'running' },
  });

  // Reconstruct per-URL inputs from stored result + originally-uploaded CSV files.
  // For Phase 1, we read the saved internal_all.csv from the upload folder.
  const internalCsvPath = await locateInternalCsv(session.id, JSON.parse(session.files || '[]'));
  if (!internalCsvPath) {
    await prisma.pillarAnalysis.update({
      where: { id: pa.id },
      data: { status: 'error', error: 'internal_all.csv not found in session uploads' },
    });
    return NextResponse.json({ error: 'internal_all_missing' }, { status: 422 });
  }

  try {
    const fs = await import('fs/promises');
    const csv = await fs.readFile(internalCsvPath, 'utf-8');
    const internalRows = new InternalParser(csv).parsePerUrlForPillar();

    // GSC/GA4/Semrush per-URL maps: read whatever exports exist alongside.
    const uploadDir = (await fs.realpath(internalCsvPath + '/..')).replace(/\/$/, '');
    const gsc = await loadGscMap(uploadDir);
    const ga4 = await loadGa4Map(uploadDir);
    const semrush = await loadSemrushMap(uploadDir);

    const result = await runPillarAnalysisFromInputs({ internalRows, gsc, ga4, semrush });

    await prisma.pillarAnalysis.update({
      where: { id: pa.id },
      data: {
        status: 'complete',
        score: result.score,
        subscores: JSON.stringify(result.subscores),
        dataCompleteness: result.dataCompleteness,
        hubRecommendation: JSON.stringify(result.hubRecommendation),
        pillarTopics: JSON.stringify(result.pillarTopics),
        urlVerdicts: JSON.stringify(result.urlVerdicts),
      },
    });

    return NextResponse.json({ id: pa.id, status: 'complete' });
  } catch (err: any) {
    await prisma.pillarAnalysis.update({
      where: { id: pa.id },
      data: { status: 'error', error: err.message?.slice(0, 500) ?? 'unknown' },
    });
    return NextResponse.json({ error: 'analysis_failed', message: err.message }, { status: 500 });
  }
}

async function locateInternalCsv(sessionId: string, files: string[]): Promise<string | null> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const uploadRoot = process.env.UPLOAD_ROOT || '/home/seo/data/seo-tools/uploads';
  for (const f of files) {
    if (!/internal_all/i.test(f)) continue;
    const full = path.join(uploadRoot, sessionId, f);
    try {
      await fs.access(full);
      return full;
    } catch { /* keep looking */ }
  }
  return null;
}

async function loadGscMap(dir: string) {
  // Reuses existing search_console parser if a file is present.
  // Phase 1 implementation: best-effort discovery; if no GSC file, return empty map.
  const fs = await import('fs/promises');
  const path = await import('path');
  const candidates = (await fs.readdir(dir)).filter((f) => /search_console|gsc/i.test(f) && f.endsWith('.csv'));
  if (candidates.length === 0) return new Map();
  const csv = await fs.readFile(path.join(dir, candidates[0]), 'utf-8');
  const rows = parseSearchConsoleCsv(csv);
  return gscMapFromParser(rows);
}

async function loadGa4Map(dir: string) {
  const fs = await import('fs/promises');
  const path = await import('path');
  const candidates = (await fs.readdir(dir)).filter((f) => /analytics|ga4/i.test(f) && f.endsWith('.csv'));
  if (candidates.length === 0) return new Map();
  const csv = await fs.readFile(path.join(dir, candidates[0]), 'utf-8');
  const rows = parseGa4Csv(csv);
  return ga4MapFromParser(rows);
}

async function loadSemrushMap(dir: string) {
  const fs = await import('fs/promises');
  const path = await import('path');
  const candidates = (await fs.readdir(dir)).filter((f) => /semrush/i.test(f) && f.endsWith('.csv'));
  if (candidates.length === 0) return new Map();
  const csv = await fs.readFile(path.join(dir, candidates[0]), 'utf-8');
  const rows = parseSemrushCsv(csv);
  return semrushMapFromParser(rows);
}

// Minimal CSV → row parsers (use existing PapaParse). Real implementations
// should call into the per-URL methods on existing parsers once those are
// extended; Phase 1 inlines them here for simplicity.
import Papa from 'papaparse';

function parseSearchConsoleCsv(csv: string) {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  return data.map((row) => ({
    url: row['Address'] || row['URL'] || '',
    clicks: Number(row['Clicks'] || row['GSC Clicks'] || 0),
    impressions: Number(row['Impressions'] || row['GSC Impressions'] || 0),
    ctr: Number(row['CTR'] || row['GSC CTR'] || 0),
    position: Number(row['Position'] || row['GSC Position'] || 0),
  }));
}

function parseGa4Csv(csv: string) {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  return data.map((row) => ({
    url: row['Address'] || row['URL'] || '',
    sessions: Number(row['GA4 Sessions'] || row['Sessions'] || 0),
    engagementRate: parseRate(row['GA4 Engagement rate'] || row['Engagement rate']),
    keyEvents: Number(row['GA4 Key events'] || row['Key events'] || 0),
  }));
}

function parseSemrushCsv(csv: string) {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  return data.map((row) => ({
    url: row['URL'] || row['Address'] || '',
    referringDomains: Number(row['Referring Domains'] || row['Domains'] || 0),
    organicKeywords: Number(row['Organic Keywords'] || row['Keywords'] || 0),
  }));
}

function parseRate(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace('%', '').trim();
  const n = Number(cleaned);
  if (Number.isNaN(n)) return 0;
  return cleaned.includes('%') || n > 1 ? n / 100 : n;
}
```

- [ ] **Step 2: Hand-test the route**

```bash
# In one terminal: npm run dev
# In another: replace SID with a real complete session id
curl -X POST http://localhost:3000/api/pillar-analysis -H 'Content-Type: application/json' -d '{"sessionId":"SID"}'
```

Expected: returns `{"id": "...", "status": "complete"}` after 5–60 seconds.

- [ ] **Step 3: Commit**

```bash
git add app/api/pillar-analysis/route.ts
git commit -m "feat(pillar): POST /api/pillar-analysis to run analysis on an existing session"
```

---

## Task 18: API route GET /api/pillar-analysis/[id]

**Files:**
- Create: `app/api/pillar-analysis/[id]/route.ts`

- [ ] **Step 1: Write the route handler**

```ts
// app/api/pillar-analysis/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pa = await prisma.pillarAnalysis.findUnique({ where: { id } });
  if (!pa) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    id: pa.id,
    sessionId: pa.sessionId,
    status: pa.status,
    error: pa.error,
    score: pa.score,
    subscores: pa.subscores ? safeJSON(pa.subscores) : null,
    dataCompleteness: pa.dataCompleteness,
    hubRecommendation: pa.hubRecommendation ? safeJSON(pa.hubRecommendation) : null,
    pillarTopics: pa.pillarTopics ? safeJSON(pa.pillarTopics) : null,
    urlVerdicts: pa.urlVerdicts ? safeJSON(pa.urlVerdicts) : null,
    createdAt: pa.createdAt,
    updatedAt: pa.updatedAt,
  });
}

function safeJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
```

- [ ] **Step 2: Hand-test**

```bash
curl http://localhost:3000/api/pillar-analysis/<id-from-task-17>
```

Expected: full JSON with score, subscores, hubRecommendation, pillarTopics, urlVerdicts.

- [ ] **Step 3: Commit**

```bash
git add app/api/pillar-analysis/\[id\]/route.ts
git commit -m "feat(pillar): GET /api/pillar-analysis/[id] returns full structured analysis"
```

---

## Task 19: Pipeline hook — trigger from seo-parser completion

**Files:**
- Modify: `app/api/parse/route.ts` (or wherever seo-parser sets `status: 'complete'`)

- [ ] **Step 1: Locate the seo-parser completion site**

Run: `grep -rn "'complete'" /Users/<you>/er-seo-tools/app/api/parse/ /Users/<you>/er-seo-tools/lib/services/aggregator.service.ts`
Expected: find the line where `status: 'complete'` is written to a Session.

- [ ] **Step 2: Add a fire-and-forget pillar-analysis trigger**

Right after the line that updates `Session.status = 'complete'` (in `app/api/parse/route.ts` or its helper), add:

```ts
// After session is marked complete, fire-and-forget the pillar analysis.
// Errors here MUST NOT fail the seo-parser request — they're logged only.
import('./pillar-analysis-trigger').then(m => m.triggerPillarAnalysis(session.id))
  .catch(err => console.error('[pillar-analysis] trigger failed', err));
```

Then create `app/api/parse/pillar-analysis-trigger.ts`:

```ts
// Calls the pillar-analysis route internally so the deterministic backbone
// runs automatically once a seo-parser crawl completes. Fire-and-forget.

export async function triggerPillarAnalysis(sessionId: string): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    const res = await fetch(`${baseUrl}/api/pillar-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[pillar-analysis] trigger non-2xx', res.status, text);
    }
  } catch (err) {
    console.error('[pillar-analysis] trigger error', err);
  }
}
```

- [ ] **Step 3: Hand-test**

Upload a small SF export through the existing `/seo-parser` flow. After the seo-parser completes, query:

```bash
curl http://localhost:3000/api/pillar-analysis/<expected-id>
```

Or query the DB directly:

```bash
npx tsx -e "import { prisma } from './lib/db.ts'; prisma.pillarAnalysis.findFirst({orderBy:{createdAt:'desc'}}).then(r => console.log(r)).finally(() => prisma.\$disconnect())"
```

Expected: a PillarAnalysis row exists with `status: 'complete'` shortly after the upload finishes.

- [ ] **Step 4: Commit**

```bash
git add app/api/parse/route.ts app/api/parse/pillar-analysis-trigger.ts
git commit -m "feat(pillar): auto-trigger pillar analysis when seo-parser completes"
```

---

## Task 20: Dashboard page — `/pillar-analysis/[id]`

**Files:**
- Create: `app/pillar-analysis/[id]/page.tsx`
- Create: `app/pillar-analysis/[id]/components/ScoreCard.tsx`
- Create: `app/pillar-analysis/[id]/components/SubscoreBreakdown.tsx`
- Create: `app/pillar-analysis/[id]/components/HubRecommendationCard.tsx`
- Create: `app/pillar-analysis/[id]/components/PillarTopicList.tsx`
- Create: `app/pillar-analysis/[id]/components/UrlVerdictTable.tsx`
- Create: `app/pillar-analysis/[id]/components/DataCompletenessBanner.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/pillar-analysis/[id]/page.tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { ScoreCard } from './components/ScoreCard';
import { SubscoreBreakdown } from './components/SubscoreBreakdown';
import { HubRecommendationCard } from './components/HubRecommendationCard';
import { PillarTopicList } from './components/PillarTopicList';
import { UrlVerdictTable } from './components/UrlVerdictTable';
import { DataCompletenessBanner } from './components/DataCompletenessBanner';
import type {
  HubRecommendation, PillarTopic, SubscoreBreakdown as SB, UrlRecord,
} from '@/lib/services/pillarAnalysis/types';

export default async function PillarAnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pa = await prisma.pillarAnalysis.findUnique({ where: { id } });
  if (!pa) notFound();
  if (pa.status !== 'complete') {
    return (
      <div className="p-8 text-gray-700 dark:text-white/80">
        Analysis status: <span className="font-mono">{pa.status}</span>
        {pa.error && <pre className="mt-4 text-red-500">{pa.error}</pre>}
      </div>
    );
  }

  const subscores = JSON.parse(pa.subscores!) as SB;
  const hub = JSON.parse(pa.hubRecommendation!) as HubRecommendation;
  const topics = JSON.parse(pa.pillarTopics!) as PillarTopic[];
  const verdicts = JSON.parse(pa.urlVerdicts!) as UrlRecord[];

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-6">
      <header className="border-b pb-4 dark:border-navy-border">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Pillar Analysis
        </h1>
        <p className="text-gray-600 dark:text-white/60 text-sm mt-1">
          Internal — analyst-only. Generated {pa.createdAt.toISOString()}
        </p>
      </header>

      {pa.dataCompleteness != null && pa.dataCompleteness < 0.5 && (
        <DataCompletenessBanner completeness={pa.dataCompleteness} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ScoreCard score={pa.score!} dataCompleteness={pa.dataCompleteness ?? 0} />
        <div className="lg:col-span-2">
          <SubscoreBreakdown subscores={subscores} />
        </div>
      </div>

      <HubRecommendationCard hub={hub} />

      <PillarTopicList topics={topics} verdicts={verdicts} />

      <UrlVerdictTable verdicts={verdicts} />
    </main>
  );
}
```

- [ ] **Step 2: Write the ScoreCard**

```tsx
// app/pillar-analysis/[id]/components/ScoreCard.tsx
export function ScoreCard({
  score, dataCompleteness,
}: { score: number; dataCompleteness: number }) {
  const completenessPct = Math.round(dataCompleteness * 100);
  return (
    <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6">
      <div className="text-sm text-gray-500 dark:text-white/60 uppercase tracking-wide">
        Site Fit Score
      </div>
      <div className="flex items-baseline gap-3 mt-2">
        <div className="text-5xl font-bold text-gray-900 dark:text-white">{score}</div>
        <div className="text-2xl text-gray-400 dark:text-white/40">/ 10</div>
      </div>
      <div className={`mt-2 text-sm ${
        completenessPct < 50 ? 'text-amber-600 dark:text-amber-400'
          : completenessPct < 100 ? 'text-gray-600 dark:text-white/60'
          : 'text-emerald-600 dark:text-emerald-400'
      }`}>
        {completenessPct}% data completeness
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the SubscoreBreakdown**

```tsx
// app/pillar-analysis/[id]/components/SubscoreBreakdown.tsx
import type { SubscoreBreakdown as SB } from '@/lib/services/pillarAnalysis/types';

const LABELS: Record<keyof SB, string> = {
  contentVolume: 'Informational content volume',
  topicalConcentration: 'Topical concentration',
  organicFootprint: 'Existing organic footprint',
  internalLinkGap: 'Internal-link gap',
  programPageClarity: 'Program-page clarity',
  backlinkDistribution: 'Backlink distribution',
};

export function SubscoreBreakdown({ subscores }: { subscores: SB }) {
  return (
    <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6">
      <div className="text-sm text-gray-500 dark:text-white/60 uppercase tracking-wide mb-4">
        Subscore Breakdown
      </div>
      <ul className="space-y-3">
        {(Object.keys(subscores) as Array<keyof SB>).map((k) => (
          <li key={k} className="flex items-center gap-3">
            <div className="w-56 text-sm text-gray-700 dark:text-white/80">{LABELS[k]}</div>
            <div className="flex-1 h-2 bg-gray-200 dark:bg-navy-border rounded">
              <div
                className="h-2 rounded bg-blue-500 dark:bg-blue-400"
                style={{ width: `${subscores[k] * 10}%` }}
              />
            </div>
            <div className="w-10 text-right font-mono text-sm text-gray-700 dark:text-white/80">
              {subscores[k].toFixed(1)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Write the HubRecommendationCard**

```tsx
// app/pillar-analysis/[id]/components/HubRecommendationCard.tsx
import type { HubRecommendation, HubFormat } from '@/lib/services/pillarAnalysis/types';

const FORMAT_LABELS: Record<HubFormat, string> = {
  'nest-under-programs': 'Nest under existing program pages',
  'hybrid': 'Hybrid (vertical → programs, horizontal → /resources/)',
  'rename-blog-to-resources': 'Rename /blog/ → /resources/ (preserves backlink equity)',
  'fresh-resources-hub': 'Build a fresh /resources/ hub',
  'fresh-career-guides-hub': 'Build a fresh /career-guides/ hub',
};

export function HubRecommendationCard({ hub }: { hub: HubRecommendation }) {
  return (
    <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6">
      <div className="text-sm text-gray-500 dark:text-white/60 uppercase tracking-wide mb-2">
        Hub Recommendation
      </div>
      <div className="text-2xl font-semibold text-gray-900 dark:text-white">
        {FORMAT_LABELS[hub.primary]}
      </div>
      {hub.reasoning.length > 0 && (
        <ul className="mt-3 list-disc pl-6 text-sm text-gray-700 dark:text-white/80 space-y-1">
          {hub.reasoning.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {hub.alternates.length > 0 && (
        <div className="mt-4 pt-4 border-t dark:border-navy-border">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-white/60 mb-2">
            Alternates
          </div>
          <ul className="space-y-1 text-sm text-gray-600 dark:text-white/70">
            {hub.alternates.slice(0, 3).map((a, i) => (
              <li key={i} className="flex justify-between">
                <span>{FORMAT_LABELS[a.format]}</span>
                <span className="font-mono text-gray-400 dark:text-white/40">
                  −{a.scoreDelta.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write the PillarTopicList**

```tsx
// app/pillar-analysis/[id]/components/PillarTopicList.tsx
'use client';
import { useState } from 'react';
import type { PillarTopic, UrlRecord } from '@/lib/services/pillarAnalysis/types';

export function PillarTopicList({
  topics, verdicts,
}: { topics: PillarTopic[]; verdicts: UrlRecord[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());

  if (topics.length === 0) {
    return (
      <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6 text-gray-600 dark:text-white/60">
        No pillar topics identified — clusters were too small or too sparse.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6">
      <div className="text-sm text-gray-500 dark:text-white/60 uppercase tracking-wide mb-4">
        Pillar Topics ({topics.length})
      </div>
      <ul className="space-y-3">
        {topics.map((t) => {
          const isOpen = open.has(t.clusterId);
          const cluster = verdicts.filter((r) => r.topicClusterId === t.clusterId);
          return (
            <li key={t.clusterId} className="border rounded dark:border-navy-border">
              <button
                onClick={() => {
                  const next = new Set(open);
                  next.has(t.clusterId) ? next.delete(t.clusterId) : next.add(t.clusterId);
                  setOpen(next);
                }}
                className="w-full text-left px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-navy-card/60"
              >
                <span className="font-semibold text-gray-900 dark:text-white">{t.name}</span>
                <span className="text-xs text-gray-500 dark:text-white/60">
                  {cluster.length} pages • pillar: {t.pillarUrl ? '✓' : '—'}
                </span>
              </button>
              {isOpen && (
                <ul className="px-4 pb-3 space-y-1 text-sm">
                  {cluster.map((r) => (
                    <li key={r.url} className="flex justify-between gap-3">
                      <a href={r.url} target="_blank" rel="noreferrer"
                         className="text-blue-600 dark:text-blue-400 truncate">
                        {r.url}
                      </a>
                      <span className="font-mono text-xs text-gray-500 dark:text-white/60">
                        {r.verdict}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Write the UrlVerdictTable**

```tsx
// app/pillar-analysis/[id]/components/UrlVerdictTable.tsx
'use client';
import { useState, useMemo } from 'react';
import type { UrlRecord, Verdict } from '@/lib/services/pillarAnalysis/types';

const VERDICTS: Verdict[] = ['pillar', 'cluster', 'leave-as-blog', 'consolidate', 'prune', 'unclear'];

export function UrlVerdictTable({ verdicts }: { verdicts: UrlRecord[] }) {
  const [filter, setFilter] = useState<Verdict | 'all'>('all');
  const [sortBy, setSortBy] = useState<'wordCount' | 'inlinks' | 'gscClicks'>('inlinks');

  const filtered = useMemo(() => {
    let xs = verdicts;
    if (filter !== 'all') xs = xs.filter((r) => r.verdict === filter);
    return [...xs].sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0));
  }, [verdicts, filter, sortBy]);

  return (
    <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6">
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-gray-500 dark:text-white/60 uppercase tracking-wide">
          URL Verdicts ({filtered.length} of {verdicts.length})
        </div>
        <div className="flex gap-3">
          <select value={filter} onChange={(e) => setFilter(e.target.value as Verdict | 'all')}
            className="text-sm border rounded px-2 py-1 dark:bg-navy-card dark:border-navy-border dark:text-white">
            <option value="all">All verdicts</option>
            {VERDICTS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'wordCount' | 'inlinks' | 'gscClicks')}
            className="text-sm border rounded px-2 py-1 dark:bg-navy-card dark:border-navy-border dark:text-white">
            <option value="inlinks">Sort: inlinks</option>
            <option value="wordCount">Sort: word count</option>
            <option value="gscClicks">Sort: GSC clicks</option>
          </select>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-gray-500 dark:text-white/60 border-b dark:border-navy-border">
          <tr>
            <th className="text-left py-2">URL</th>
            <th className="text-left">Verdict</th>
            <th className="text-right">Words</th>
            <th className="text-right">Inlinks</th>
            <th className="text-right">GSC clicks</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 200).map((r) => (
            <tr key={r.url} className="border-b dark:border-navy-border/50">
              <td className="py-2 truncate max-w-md">
                <a href={r.url} target="_blank" rel="noreferrer"
                   className="text-blue-600 dark:text-blue-400">{r.url}</a>
              </td>
              <td className="font-mono text-xs">{r.verdict}</td>
              <td className="text-right font-mono">{r.wordCount ?? '—'}</td>
              <td className="text-right font-mono">{r.inlinks ?? '—'}</td>
              <td className="text-right font-mono">{r.gscClicks ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 200 && (
        <p className="text-xs text-gray-500 dark:text-white/60 mt-3">
          Showing first 200 of {filtered.length}.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write the DataCompletenessBanner**

```tsx
// app/pillar-analysis/[id]/components/DataCompletenessBanner.tsx
export function DataCompletenessBanner({ completeness }: { completeness: number }) {
  const pct = Math.round(completeness * 100);
  return (
    <div className="rounded border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-400 p-4">
      <div className="font-semibold text-amber-800 dark:text-amber-300">
        Low-confidence score: only {pct}% of signals available
      </div>
      <div className="text-sm text-amber-700 dark:text-amber-200/80 mt-1">
        GSC and/or Semrush data are missing. Treat the score as directional only.
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Hand-test in the browser**

Run: `npm run dev` and visit `http://localhost:3000/pillar-analysis/<id>`
Expected: page renders score, subscores, hub recommendation, expandable pillar topics, and a sortable/filterable URL verdict table. Dark-mode styling matches the rest of the app.

- [ ] **Step 9: Commit**

```bash
git add app/pillar-analysis/
git commit -m "feat(pillar): dashboard at /pillar-analysis/[id]"
```

---

## Task 21: Smoke test on real SF export

**Files:** none (manual validation step)

- [ ] **Step 1: Acquire a recent SF export from a real higher-ed client**

Place a folder of CSVs (`internal_all.csv`, optionally `search_console_all.csv`, `analytics_all.csv`) on the local machine. Use the existing `/seo-parser` upload UI to import.

- [ ] **Step 2: Wait for the seo-parser to complete**

The pipeline hook from Task 19 will trigger pillar analysis automatically. Watch the Next.js dev console for `[pillar-analysis]` logs.

- [ ] **Step 3: Open the dashboard and sanity-check**

Visit `http://localhost:3000/pillar-analysis/<id>`. Verify:
- Score is reasonable (not always 1 or always 10).
- Subscores have variance.
- At least 1–3 pillar topics show up if the site has any blog content.
- URL verdict table is non-empty and sortable.
- DataCompleteness flag is correct (e.g. 50% if no GSC export was uploaded).

If any of these fails, the right next step is to bisect — check if the analysis ran (`prisma.pillarAnalysis.findFirst({orderBy:{createdAt:'desc'}})`), inspect the stored JSON columns, and trace back through the orchestrator.

- [ ] **Step 4: Document any tuning needed**

Note any thresholds that produced obviously-wrong results (e.g. `clusterSimilarityThreshold = 0.55` gives one giant cluster). Edit `lib/services/pillarAnalysis/config.ts` defaults — Phase 2 / 3 PRs can refine.

- [ ] **Step 5: Commit any tuning changes**

```bash
git add lib/services/pillarAnalysis/config.ts
git commit -m "fix(pillar): adjust default thresholds based on smoke-test feedback"
```

---

## Task 22: PR

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/pillar-analysis-phase-1
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: pillar analysis Phase 1 — deterministic backbone" --body "$(cat <<'EOF'
## Summary
- Adds `PillarAnalysis` Prisma model + migration.
- New service `lib/services/pillarAnalysis/` with: per-URL join, page-type classifier (URL-slug primary), intent classifier (rule-based), local MiniLM embeddings via `@xenova/transformers`, agglomerative clustering, six-subscore site fit score with `dataCompleteness`, hub-format decision tree, rank-based per-URL verdict assignment.
- API: `POST /api/pillar-analysis` (run on a session), `GET /api/pillar-analysis/[id]` (fetch result).
- Pipeline hook auto-triggers analysis after `/seo-parser` completes.
- Dashboard at `/pillar-analysis/[id]` renders the deterministic output for analysts.
- Phase 1 only — no skill, no clipboard payload, no narrative writeback (those are Phase 2).

Spec: `docs/superpowers/specs/2026-04-28-pillar-analysis-design.md`
Plan: `docs/superpowers/plans/2026-04-28-pillar-analysis-phase-1.md`

## Test plan
- [ ] Run full vitest suite — all pass.
- [ ] Smoke-test on a real higher-ed SF export via `/seo-parser` upload.
- [ ] Verify automatic pillar-analysis trigger fires on completion.
- [ ] Open the dashboard, confirm rendering + sorting/filtering work.
- [ ] Verify `dataCompleteness` banner appears when GSC/Semrush exports are absent.
- [ ] Check RAM after first analysis (`top -p $(pgrep -f next-server)`); MiniLM should add ~150MB resident.
- [ ] Confirm `postinstall` model pre-warm runs on a clean `npm ci` in a deploy environment.
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review

Verifying the plan against the spec:

**§3 architecture coverage:** ✓ services structure (Tasks 3–16), Prisma model (Task 2), API endpoints (Tasks 17–18), pipeline hook (Task 19), config module (Task 4), `@xenova/transformers` + postinstall (Task 1), `narrativeUpdatedAt` field (Task 2). Phase 2 items (mint-token endpoint, "Copy Claude Prompt" button, PATCH narrative) explicitly excluded — correct per spec §15.

**§4 schema coverage:** ✓ all `UrlRecord` fields defined in Task 3 `types.ts`. Stored as JSON in `urlVerdicts` column per Task 17.

**§5 page-type:** ✓ hierarchical signal precedence in Task 5; URL-slug primary, schema tiebreaker, depth tertiary.

**§6 clustering:** ✓ Transformers.js MiniLM embeddings (Task 7), agglomerative clustering (Task 8), thresholds in config (Task 4).

**§7 intent:** ✓ rule-based with pageType fallback in Task 6.

**§8 score + dataCompleteness rules:** ✓ Task 12 implements all six subscores + completeness tracking; Task 20 implements the UI banner below 0.5 completeness.

**§9 hub-format:** ✓ Task 13 implements the decision tree; Task 14 supplies cluster verticality; alternates with score deltas included.

**§10 verdicts:** ✓ Task 11 implements rank-based authority composite (n=3-safe), all five buckets + unclear, edge cases (commercial in cluster, singleton with authority).

**§11 skill:** out of scope for Phase 1 per §15 — confirmed not in plan.

**§12 auth:** out of scope for Phase 1 — JWT mint-token is Phase 2. POST/GET are unauthenticated for now (internal network).

**§13 risks:**
- RAM/cold start (#1): smoke-test step in Task 21 explicitly checks `top`.
- Public reachability (#2): not relevant for Phase 1 — no skill calling in.
- Page-type weird IA (#5): override table is in spec for Phase 3; for Phase 1 the analyst can re-tag URLs by adjusting Client model JSON manually (acknowledged in Task 5).
- Backlink data missing (#6): `dataCompleteness` flag handles this; Task 12 tests cover the missing-Semrush case.
- Memo quality drift (#7): Phase 2 concern.

**§15 phase scoping:** ✓ plan covers Phase 1 only. Tasks 17–22 are scoped to deterministic backbone + dashboard + auto-trigger + smoke test + PR. No Phase 2 or 3 work bleeds in.

**Placeholder scan:** no "TBD", "TODO", or "implement later" appears. Every code step contains complete code. Every test step has assertions. Every command step has expected output.

**Type consistency:** `UrlRecord`, `PageType`, `IntentClass`, `Verdict`, `HubFormat`, `SubscoreBreakdown`, `HubRecommendation`, `PillarTopic`, `PillarAnalysisResult` — defined once in Task 3, imported consistently across Tasks 5–16, 20. `PillarConfig` defined in Task 4 used in Tasks 11, 12, 13, 16. Method names match across tasks (`classifyPageType`, `classifyIntent`, `embedTexts`, `cosineSimilarity`, `agglomerativeCluster`, `joinUrlRecords`, `assignVerdicts`, `computeFitScore`, `decideHubFormat`, `computeClusterVerticality`, `nameClusters`, `runPillarAnalysisFromInputs`).

One ambiguity worth flagging for the executor: in Task 17 the API route calls `parsePerUrlForPillar()` on a fresh `InternalParser` instance, which means the CSV has to be re-read from disk even though the seo-parser already parsed it once. This is intentional for Phase 1 simplicity (the existing `Session.result` JSON doesn't include the per-URL detail we need). Phase 3 may revisit this for performance if the re-parse cost becomes painful on large crawls.
