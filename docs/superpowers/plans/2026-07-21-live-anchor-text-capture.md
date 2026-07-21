# Live-scan anchor-text capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live-scan (seoIntent) pipeline capture `<a href>` anchor text and emit SF's three anchor findings (`empty_anchor_text` / `non_descriptive_anchor_text` / `single_anchor_variation`) on the live-scan `CrawlRun` — the Phase-7 SF-retirement prerequisite.

**Architecture:** In-page harvest extracts per-anchor text (self-contained injected fn) → stored on a new nullable `HarvestedLink.anchorText` (dedup/cap UNCHANGED) → the `broken-link-verify` builder aggregates via a bounded O(1)-per-target reducer folded into the existing keyset stream → a pure `mapAnchorTextFindings` emits the 3 findings, merged into the one live-scan run → a durable `CrawlRun.anchorSummaryJson` marks "analysis ran". Measurement-only (no score change). A shared module keeps the live rule identical to the SF parser.

**Tech Stack:** Next.js 15 / TypeScript / Prisma+SQLite / puppeteer-core / Vitest.

**Spec:** `docs/superpowers/specs/2026-07-21-live-anchor-text-capture-design.md` (Codex-reviewed, 7 fixes applied).

## Global Constraints

- **Measurement-only:** NO change to `lib/ada-audit/seo/live-seo-score.ts` or `live-seo-score.test.ts`. Anchor findings never enter the live score.
- **`HarvestedLink` dedup/cap UNCHANGED:** never alter `classifyTargets`' `(kind,url)` dedup or the 300 `HARVEST_CAP`, and never change the builder's `internalPairs` construction. Anchor is an added column value on already-surviving rows only.
- **Injected-code contract:** any function passed into `page.evaluate` via `.toString()` MUST be self-contained (no module-scope refs, no imported constants) and MUST NOT emit an escaping SWC helper at es2017 (no `typeof`; avoid `_object_spread`/`_define_property`/`_instanceof`/`_type_of`).
- **Array-form `$transaction([...])` only** — never interactive `prisma.$transaction(async tx => …)`.
- **Characterization tests stay FROZEN:** do NOT re-pin `lib/jobs/handlers/broken-link-verify.characterization.test.ts` or `lib/parsers/resources/anchortext.golden.test.ts`. The design keeps their output byte-identical.
- **null vs empty contract:** `HarvestedLink.anchorText === null` = not-an-internal-observation / legacy → skip; `=== ''` = captured empty internal anchor → `empty_anchor_text`. Internal-link rows always carry a string; image/external rows carry null.
- **`ANCHOR_TEXT_MAX = 2048`** — the same literal must appear inline in the injected extractor AND as the shared constant.
- **findingUnit noun:** `empty_anchor_text`/`non_descriptive_anchor_text` → `'links'`; `single_anchor_variation` → `'pages'`.
- Test runner: `npx vitest run <path>`. Full gates before PR: `npm run lint` (tsc) · `npm test` · `npm run build`.

---

### Task 1: Schema migration — anchor columns

**Files:**
- Modify: `prisma/schema.prisma` (`model HarvestedLink` ~437, `model CrawlRun`)
- Create: `prisma/migrations/<timestamp>_anchor_text_capture/migration.sql` (generated)

**Interfaces:**
- Produces: `HarvestedLink.anchorText String?`, `CrawlRun.anchorSummaryJson String?` (used by Tasks 4, 7, 8).

- [ ] **Step 1: Add the columns to the schema**

In `prisma/schema.prisma`, `model HarvestedLink`, after `harvestTruncated`:
```prisma
  anchorText       String?   // anchor-text: normalized visible anchor for internal-link rows; null for images/external/legacy
```
In `model CrawlRun`, alongside the other nullable `*Json` columns (e.g. near `schemaTypesJson`):
```prisma
  anchorSummaryJson       String?  // anchor-text: {v,targetsObserved,targetsTruncated,harvestTruncated}; null = analysis did not run
```

- [ ] **Step 2: Generate the migration + client**

Run: `npx prisma migrate dev --name anchor_text_capture`
Expected: creates `prisma/migrations/<ts>_anchor_text_capture/migration.sql` with two `ALTER TABLE ... ADD COLUMN`, regenerates the client, no errors.

- [ ] **Step 3: Verify the migration SQL is additive-only**

Run: `cat prisma/migrations/*_anchor_text_capture/migration.sql`
Expected: exactly two `ALTER TABLE "HarvestedLink" ADD COLUMN "anchorText" TEXT;` and `ALTER TABLE "CrawlRun" ADD COLUMN "anchorSummaryJson" TEXT;` — no drops, no NOT NULL, no defaults.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(anchor-text): additive schema — HarvestedLink.anchorText + CrawlRun.anchorSummaryJson"
```

---

### Task 2: Shared non-descriptive-anchor module + SF-parser refactor

**Files:**
- Create: `lib/findings/anchor-text-shared.ts`
- Create: `lib/findings/anchor-text-shared.test.ts`
- Modify: `lib/parsers/resources/anchorText.parser.ts` (import the shared list + `isNonDescriptiveAnchor`)

**Interfaces:**
- Produces: `NON_DESCRIPTIVE_ANCHORS: readonly string[]`, `ANCHOR_TEXT_MAX: 2048`, `normalizeAnchorText(raw: string): string`, `isNonDescriptiveAnchor(text: string): boolean` (used by Tasks 3, 4, 6, 7).

- [ ] **Step 1: Write the failing test** — `lib/findings/anchor-text-shared.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  NON_DESCRIPTIVE_ANCHORS, ANCHOR_TEXT_MAX, normalizeAnchorText, isNonDescriptiveAnchor,
} from './anchor-text-shared'
import { AnchorTextParser } from '@/lib/parsers/resources/anchorText.parser'

describe('anchor-text-shared', () => {
  it('normalizeAnchorText trims and caps at ANCHOR_TEXT_MAX (no whitespace collapse)', () => {
    expect(normalizeAnchorText('  hello  ')).toBe('hello')
    expect(normalizeAnchorText('a  b')).toBe('a  b') // interior whitespace preserved (SF-faithful)
    expect(normalizeAnchorText('x'.repeat(3000)).length).toBe(ANCHOR_TEXT_MAX)
    expect(ANCHOR_TEXT_MAX).toBe(2048)
  })
  it('isNonDescriptiveAnchor is case-insensitive membership', () => {
    expect(isNonDescriptiveAnchor('Click Here')).toBe(true)
    expect(isNonDescriptiveAnchor('  read more ')).toBe(true)
    expect(isNonDescriptiveAnchor('Apply to the Nursing Program')).toBe(false)
    expect(isNonDescriptiveAnchor('')).toBe(false)
  })
  it('parity: the SF parser uses the SAME non-descriptive list', () => {
    // The parser must reference the shared constant, not a private copy.
    expect(NON_DESCRIPTIVE_ANCHORS).toEqual(
      (AnchorTextParser as unknown as { NON_DESCRIPTIVE_ANCHORS: readonly string[] }).NON_DESCRIPTIVE_ANCHORS,
    )
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run lib/findings/anchor-text-shared.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the shared module** — `lib/findings/anchor-text-shared.ts`

```ts
// lib/findings/anchor-text-shared.ts
//
// CLIENT-SAFE single source of truth for anchor-text normalization + the
// non-descriptive list, shared by the SF parser (anchorText.parser.ts) and the
// live-scan builder/mapper so the live rule never drifts from SF. No server imports.

export const ANCHOR_TEXT_MAX = 2048

// Trim only + a size guard (SF trims only; the cap bounds pathological DOM text
// and is effectively never hit — see spec §6 fix-6). NOT a whitespace collapse.
export function normalizeAnchorText(raw: string): string {
  return raw.trim().slice(0, ANCHOR_TEXT_MAX)
}

export const NON_DESCRIPTIVE_ANCHORS: readonly string[] = [
  'click here', 'read more', 'learn more', 'more', 'here', 'link', 'this',
  'page', 'click', 'go', 'see more', 'view more', 'continue', 'details', 'info',
]
const NON_DESCRIPTIVE_SET = new Set(NON_DESCRIPTIVE_ANCHORS)

export function isNonDescriptiveAnchor(text: string): boolean {
  return NON_DESCRIPTIVE_SET.has(text.trim().toLowerCase())
}
```

- [ ] **Step 4: Refactor the SF parser to import the shared list**

In `lib/parsers/resources/anchorText.parser.ts`:
- Add at top: `import { NON_DESCRIPTIVE_ANCHORS, isNonDescriptiveAnchor } from '@/lib/findings/anchor-text-shared'`
- Replace the private `private static NON_DESCRIPTIVE_ANCHORS = [...]` block with `private static NON_DESCRIPTIVE_ANCHORS = NON_DESCRIPTIVE_ANCHORS` (keep the static so the parity test + any references resolve).
- Replace the membership check on ~line 60 `if (AnchorTextParser.NON_DESCRIPTIVE_ANCHORS.includes(normalizedAnchor))` with `if (isNonDescriptiveAnchor(anchor))` (equivalent — `isNonDescriptiveAnchor` lowercases+trims internally; `anchor` here is the trimmed raw).

- [ ] **Step 5: Run the shared test + the frozen SF golden**

Run: `npx vitest run lib/findings/anchor-text-shared.test.ts lib/parsers/resources/anchortext.golden.test.ts`
Expected: PASS (both) — the golden proves the parser refactor is behavior-preserving.

- [ ] **Step 6: Commit**

```bash
git add lib/findings/anchor-text-shared.ts lib/findings/anchor-text-shared.test.ts lib/parsers/resources/anchorText.parser.ts
git commit -m "feat(anchor-text): shared non-descriptive list + normalizer; SF parser imports it"
```

---

### Task 3: In-page anchor extraction + classify

**Files:**
- Modify: `lib/ada-audit/link-harvest.ts`
- Modify: `lib/ada-audit/link-harvest.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `harvestAnchorsFromDocument(document): { href: string; text: string }[]` (module-level, injected); `HarvestedTarget.anchorText?: string`; `classifyTargets` now accepts anchor pairs and attaches first-occurrence anchor to surviving internal targets. `harvestLinks` return shape unchanged except internal targets carry `anchorText`.

- [ ] **Step 1: Write the failing tests** — append to `lib/ada-audit/link-harvest.test.ts`

```ts
import { JSDOM } from 'jsdom'
import { harvestAnchorsFromDocument } from './link-harvest'

describe('harvestAnchorsFromDocument', () => {
  const doc = (html: string) => new JSDOM(html).window.document
  it('extracts trimmed textContent per <a href>', () => {
    const out = harvestAnchorsFromDocument(doc('<a href="/a">  Programs </a><a href="/b">Apply</a>'))
    expect(out).toEqual([{ href: '/a', text: 'Programs' }, { href: '/b', text: 'Apply' }])
  })
  it('falls back to descendant img alt when text is empty', () => {
    const out = harvestAnchorsFromDocument(doc('<a href="/logo"><img src="l.png" alt="Home"></a>'))
    expect(out[0]).toEqual({ href: '/logo', text: 'Home' })
  })
  it('empty when neither text nor img alt', () => {
    const out = harvestAnchorsFromDocument(doc('<a href="/x"><img src="l.png"></a>'))
    expect(out[0]).toEqual({ href: '/x', text: '' })
  })
  it('truncates at 2048 chars', () => {
    const out = harvestAnchorsFromDocument(doc(`<a href="/x">${'z'.repeat(3000)}</a>`))
    expect(out[0].text.length).toBe(2048)
  })
  it('injected source is SWC-helper-free (no typeof / escaping helpers)', () => {
    const src = harvestAnchorsFromDocument.toString()
    expect(src).not.toMatch(/_type_of|_object_spread|_define_property|_instanceof|require\(/)
    expect(src).not.toMatch(/\btypeof\b/)
  })
})

describe('classifyTargets anchor capture', () => {
  it('attaches first-occurrence anchorText to internal links, dedup unchanged', () => {
    const { targets } = classifyTargets(
      ['/a', '/a'], [], 'ex.com', 'https://ex.com/', 300,
      [{ href: '/a', text: 'First' }, { href: '/a', text: 'Second' }],
    )
    const internal = targets.filter((t) => t.kind === 'internal-link')
    expect(internal).toHaveLength(1) // (kind,url) dedup unchanged
    expect(internal[0].anchorText).toBe('First') // first occurrence wins
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run lib/ada-audit/link-harvest.test.ts`
Expected: FAIL (`harvestAnchorsFromDocument` not exported; `classifyTargets` arity).

- [ ] **Step 3: Add the extractor + thread anchor through classify** — `lib/ada-audit/link-harvest.ts`

Add the interface field:
```ts
export interface HarvestedTarget {
  targetUrl: string
  kind: HarvestedTargetKind
  anchorText?: string
}
```
Add the self-contained extractor (must stay SWC-helper-free — no `typeof`):
```ts
/** Self-contained: injected into the page via .toString(). Returns {href,text}
 *  per <a href>; text = trimmed textContent, else first descendant img alt,
 *  capped at 2048 (== ANCHOR_TEXT_MAX; the literal is inlined because injected
 *  code cannot import module constants). MUST NOT emit an SWC helper. */
export function harvestAnchorsFromDocument(document: Document): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = []
  const anchors = document.querySelectorAll('a[href]')
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const href = a.getAttribute('href') || ''
    let text = (a.textContent || '').trim()
    if (!text) {
      const img = a.querySelector('img[alt]')
      if (img) text = (img.getAttribute('alt') || '').trim()
    }
    if (text.length > 2048) text = text.slice(0, 2048)
    out.push({ href: href, text: text })
  }
  return out
}
```
Update `classifyTargets` to take an optional anchor-pairs arg and attach the first anchor per surviving internal target. Keep the existing `seen` dedup exactly:
```ts
export function classifyTargets(
  linkHrefs: string[],
  imageSrcs: string[],
  auditedHost: string,
  base: string,
  cap: number,
  anchorPairs?: { href: string; text: string }[],
): { targets: HarvestedTarget[]; truncated: boolean } {
  // Map raw href -> first anchor text (first occurrence wins).
  const anchorByHref = new Map<string, string>()
  if (anchorPairs) for (const p of anchorPairs) if (!anchorByHref.has(p.href)) anchorByHref.set(p.href, p.text)

  const seen = new Set<string>()
  const all: HarvestedTarget[] = []
  const consider = (raw: string, internalKind: HarvestedTargetKind) => {
    const url = normalizeLinkTarget(raw, base)
    if (!url) return
    let host: string
    try { host = new URL(url).hostname.toLowerCase() } catch { return }
    const kind: HarvestedTargetKind = sameDomain(host, auditedHost.toLowerCase()) ? internalKind : 'external-link'
    const key = `${kind} ${url}`
    if (seen.has(key)) return
    seen.add(key)
    const t: HarvestedTarget = { targetUrl: url, kind }
    if (kind === 'internal-link' && anchorByHref.has(raw)) t.anchorText = anchorByHref.get(raw)
    all.push(t)
  }
  for (const h of linkHrefs) consider(h, 'internal-link')
  for (const s of imageSrcs) consider(s, 'image')
  const truncated = all.length > cap
  return { targets: truncated ? all.slice(0, cap) : all, truncated }
}
```
Update `harvestLinks` to extract anchors in the same `page.evaluate` and pass them through:
```ts
export async function harvestLinks(
  page: Page,
  auditedHost: string,
): Promise<{ targets: HarvestedTarget[]; truncated: boolean; pageSeo: RawPageSeo | null }> {
  const { links, images, anchors, seo } = await page.evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href') || '');
    const images = Array.from(document.querySelectorAll('img[src]')).map(i => i.getAttribute('src') || '');
    const anchors = (${harvestAnchorsFromDocument.toString()})(document);
    const seo = (${parseSeoFromDocument.toString()})(document, window);
    return { links, images, anchors, seo };
  })()`) as { links: string[]; images: string[]; anchors: { href: string; text: string }[]; seo: RawPageSeo }
  const { targets, truncated } = classifyTargets(links, images, auditedHost, page.url(), HARVEST_CAP, anchors)
  return { targets, truncated, pageSeo: seo ?? null }
}
```
Note: `anchorByHref` keys on the RAW `href` (matching what `consider` receives), so resolution/dedup stay unchanged.

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run lib/ada-audit/link-harvest.test.ts`
Expected: PASS (all, including the SWC guard).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/link-harvest.ts lib/ada-audit/link-harvest.test.ts
git commit -m "feat(anchor-text): in-page anchor extraction + classify attaches first-occurrence anchor"
```

---

### Task 4: Persist anchorText on HarvestedLink

**Files:**
- Modify: `lib/jobs/handlers/site-audit-page.ts` (`persistHarvest` ~64-84)
- Test: `lib/jobs/handlers/site-audit-page.test.ts` (add a case; if the file has no persistHarvest test, add one for the row mapping via a mocked prisma)

**Interfaces:**
- Consumes: `normalizeAnchorText` (Task 2), `HarvestedTarget.anchorText` (Task 3).
- Produces: `HarvestedLink` rows where internal-link rows carry `anchorText` (string, `''` if empty), image/external carry `null`.

- [ ] **Step 1: Write the failing test** — assert the row mapping

Add to `lib/jobs/handlers/site-audit-page.test.ts` (follow the file's existing prisma-mock pattern; if `persistHarvest` isn't exported, export it for testing like `persistPageSeo` is):
```ts
it('persistHarvest maps anchorText: string for internal, null for image/external', async () => {
  const created: any[] = []
  vi.mocked(prisma.harvestedLink.createMany).mockImplementation(async ({ data }: any) => { created.push(...data); return { count: data.length } })
  await persistHarvest('sa1', 'https://ex.com/p', [
    { targetUrl: 'https://ex.com/a', kind: 'internal-link', anchorText: '  Programs ' },
    { targetUrl: 'https://ex.com/b', kind: 'internal-link', anchorText: '' },
    { targetUrl: 'https://cdn.ex.com/i.png', kind: 'image' },
    { targetUrl: 'https://other.com', kind: 'external-link' },
  ], false)
  expect(created.map((r) => r.anchorText)).toEqual(['Programs', '', null, null])
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run lib/jobs/handlers/site-audit-page.test.ts -t anchorText`
Expected: FAIL (`anchorText` undefined on rows).

- [ ] **Step 3: Implement** — in `persistHarvest`, import `normalizeAnchorText` and extend the row map:

```ts
import { normalizeAnchorText } from '@/lib/findings/anchor-text-shared'
// ...
  const rows = targets.map((t) => ({
    siteAuditId,
    sourcePageUrl: src,
    targetUrl: t.targetUrl,
    kind: t.kind,
    harvestTruncated: truncated,
    anchorText: t.kind === 'internal-link' ? normalizeAnchorText(t.anchorText ?? '') : null,
  }))
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run lib/jobs/handlers/site-audit-page.test.ts -t anchorText`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/site-audit-page.ts lib/jobs/handlers/site-audit-page.test.ts
git commit -m "feat(anchor-text): persistHarvest writes normalized anchorText (internal only)"
```

---

### Task 5: Type sets + `IssueUnit: 'links'` end-to-end

**Files:**
- Modify: `lib/findings/finding-type-sets.ts`
- Modify: `lib/sweep/types.ts` (`IssueUnit` ~68, `ISSUE_UNITS` ~163)
- Modify: `components/issues/chips.tsx` (`UNIT_LABEL` ~42)
- Test: `lib/findings/finding-type-sets.test.ts`

**Interfaces:**
- Produces: `ANCHOR_FINDING_TYPES`, `ANCHOR_FINDING_TYPE_SET`, `ANCHOR_FINDING_LABELS`; `IssueUnit` includes `'links'`; `findingUnit` returns `'links'`/`'pages'` for anchor types (used by Tasks 6, 8 + the weekly sweep).

- [ ] **Step 1: Write the failing test** — add to `lib/findings/finding-type-sets.test.ts`

```ts
import { ANCHOR_FINDING_TYPES, ANCHOR_FINDING_TYPE_SET, ANCHOR_FINDING_LABELS, findingUnit } from './finding-type-sets'

describe('anchor finding types', () => {
  it('exposes the 3 anchor types with labels', () => {
    expect([...ANCHOR_FINDING_TYPES]).toEqual(['empty_anchor_text', 'non_descriptive_anchor_text', 'single_anchor_variation'])
    for (const t of ANCHOR_FINDING_TYPES) expect(ANCHOR_FINDING_LABELS[t]).toBeTruthy()
    expect(ANCHOR_FINDING_TYPE_SET.has('empty_anchor_text')).toBe(true)
  })
  it('findingUnit: empty/non-descriptive -> links, single-variation -> pages', () => {
    expect(findingUnit('seo-parser', 'empty_anchor_text')).toBe('links')
    expect(findingUnit('seo-parser', 'non_descriptive_anchor_text')).toBe('links')
    expect(findingUnit('seo-parser', 'single_anchor_variation')).toBe('pages')
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run lib/findings/finding-type-sets.test.ts`
Expected: FAIL (exports missing; `findingUnit` returns null → not 'links').

- [ ] **Step 3: Implement finding-type-sets** — add after the on-page block:

```ts
export const ANCHOR_FINDING_TYPES = [
  'empty_anchor_text',
  'non_descriptive_anchor_text',
  'single_anchor_variation',
] as const
export type AnchorFindingType = (typeof ANCHOR_FINDING_TYPES)[number]
export const ANCHOR_FINDING_TYPE_SET: ReadonlySet<string> = new Set(ANCHOR_FINDING_TYPES)
const anchorLabels = {
  empty_anchor_text: 'Empty anchor text',
  non_descriptive_anchor_text: 'Non-descriptive anchor text',
  single_anchor_variation: 'Single anchor-text variation',
} satisfies Record<AnchorFindingType, string>
export const ANCHOR_FINDING_LABELS: Readonly<Record<string, string>> = anchorLabels
```
Extend the `IssueUnit` type + add anchor cases to `findingUnit`:
```ts
export type IssueUnit = 'pages' | 'targets' | 'groups' | 'links'
// ...inside findingUnit, before the final `return null`:
  if (type === 'empty_anchor_text' || type === 'non_descriptive_anchor_text') return 'links'
  if (type === 'single_anchor_variation') return 'pages'
```

- [ ] **Step 4: Propagate `'links'` to the sweep + chips**

In `lib/sweep/types.ts`: `export type IssueUnit = 'pages' | 'targets' | 'groups' | 'links'` (~68) and `const ISSUE_UNITS: readonly IssueUnit[] = ['pages', 'targets', 'groups', 'links']` (~163).
In `components/issues/chips.tsx` `UNIT_LABEL`:
```ts
const UNIT_LABEL: Record<IssueUnit, string> = {
  pages: 'pages',
  targets: 'targets',
  groups: 'groups',
  links: 'links',
}
```

- [ ] **Step 5: Run the type-set + sweep type tests**

Run: `npx vitest run lib/findings/finding-type-sets.test.ts lib/sweep`
Expected: PASS (the sweep's strict-parse tests accept `'links'`).

- [ ] **Step 6: Commit**

```bash
git add lib/findings/finding-type-sets.ts lib/sweep/types.ts components/issues/chips.tsx lib/findings/finding-type-sets.test.ts
git commit -m "feat(anchor-text): register 3 anchor finding types + IssueUnit 'links' end-to-end"
```

---

### Task 6: Pure anchor-text mapper

**Files:**
- Create: `lib/findings/anchor-text-mapper.ts`
- Create: `lib/findings/anchor-text-mapper.test.ts`

**Interfaces:**
- Consumes: `runFindingKey`, `pageFindingKey`, `normalizeFindingUrl` from `./keys`; `FindingInput`, `CrawlPageInput` from `./types`.
- Produces: `AnchorAggregate` interface + `mapAnchorTextFindings(agg, { runId, ensurePage }): FindingInput[]` (used by Task 7).

- [ ] **Step 1: Write the failing test** — `lib/findings/anchor-text-mapper.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { mapAnchorTextFindings, type AnchorAggregate } from './anchor-text-mapper'
import type { CrawlPageInput } from './types'

const deps = () => {
  const pages = new Map<string, CrawlPageInput>()
  return {
    runId: 'run1',
    ensurePage: (url: string) => {
      let p = pages.get(url)
      if (!p) { p = { id: `pg-${pages.size}`, runId: 'run1', url } as CrawlPageInput; pages.set(url, p) }
      return p
    },
  }
}
const base = (): AnchorAggregate => ({
  emptyCount: 0, emptySources: [], nonDescriptiveCount: 0, nonDescriptiveSources: [],
  singleVariationCount: 0, singleVariationTargets: [], harvestTruncated: false, targetsTruncated: false,
})

describe('mapAnchorTextFindings', () => {
  it('empty_anchor_text: run finding + page rows per source with per-source counts', () => {
    const agg = { ...base(), emptyCount: 3, emptySources: [{ url: 'https://e/p1', count: 2 }, { url: 'https://e/p2', count: 1 }] }
    const f = mapAnchorTextFindings(agg, deps())
    const run = f.find((x) => x.scope === 'run' && x.type === 'empty_anchor_text')!
    expect(run.count).toBe(3)
    expect(run.severity).toBe('warning')
    const pages = f.filter((x) => x.scope === 'page' && x.type === 'empty_anchor_text')
    expect(pages.map((p) => p.count)).toEqual([2, 1])
  })
  it('single_anchor_variation: fires only when > 10, run-scope ONLY (no page rows)', () => {
    const ten = { ...base(), singleVariationCount: 10, singleVariationTargets: Array.from({ length: 10 }, (_, i) => `https://e/${i}`) }
    expect(mapAnchorTextFindings(ten, deps()).some((x) => x.type === 'single_anchor_variation')).toBe(false)
    const eleven = { ...base(), singleVariationCount: 11, singleVariationTargets: ['https://e/x'] }
    const f = mapAnchorTextFindings(eleven, deps())
    const runs = f.filter((x) => x.type === 'single_anchor_variation')
    expect(runs).toHaveLength(1)
    expect(runs[0].scope).toBe('run')
    expect(JSON.parse(runs[0].detail!).sample).toEqual(['https://e/x'])
  })
  it('single_anchor_variation affectedComplete false when targetsTruncated', () => {
    const agg = { ...base(), singleVariationCount: 11, singleVariationTargets: ['x'], targetsTruncated: true }
    expect(mapAnchorTextFindings(agg, deps())[0].affectedComplete).toBe(false)
  })
  it('emits nothing when all counts zero', () => {
    expect(mapAnchorTextFindings(base(), deps())).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run lib/findings/anchor-text-mapper.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/findings/anchor-text-mapper.ts`

```ts
// lib/findings/anchor-text-mapper.ts
//
// Pure: anchor aggregate -> FindingInput[] for the live-scan CrawlRun.
// empty/non-descriptive are page-scoped by SOURCE page (per-source counts);
// single_anchor_variation is RUN-SCOPE ONLY (destination sample in detail) so
// ensurePage is never called for an un-audited destination (no phantom pages).
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import type { CrawlPageInput, FindingInput } from './types'

export interface AnchorAggregate {
  emptyCount: number
  emptySources: { url: string; count: number }[]
  nonDescriptiveCount: number
  nonDescriptiveSources: { url: string; count: number }[]
  singleVariationCount: number
  singleVariationTargets: string[]
  harvestTruncated: boolean
  targetsTruncated: boolean
}
export interface AnchorMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
}

const SEVERITY = { empty_anchor_text: 'warning', non_descriptive_anchor_text: 'notice', single_anchor_variation: 'notice' } as const
const DESC = {
  empty_anchor_text: 'Internal links whose anchor text is empty.',
  non_descriptive_anchor_text: 'Internal links with non-descriptive anchor text (e.g. "click here", "read more").',
  single_anchor_variation: 'Destination pages that receive internal links with only one anchor-text variation.',
}

export function mapAnchorTextFindings(agg: AnchorAggregate, deps: AnchorMapDeps): FindingInput[] {
  const { runId, ensurePage } = deps
  const out: FindingInput[] = []
  const pageComplete = !agg.harvestTruncated

  const perSource = (type: 'empty_anchor_text' | 'non_descriptive_anchor_text', count: number, sources: { url: string; count: number }[]) => {
    if (count <= 0) return
    out.push({
      id: randomUUID(), runId, pageId: null, scope: 'run', type, severity: SEVERITY[type],
      url: null, count, affectedComplete: pageComplete, affectedSource: 'live-scan-anchor',
      detail: JSON.stringify({ description: DESC[type] }), dedupKey: runFindingKey(type),
    })
    for (const s of sources) {
      const url = normalizeFindingUrl(s.url)
      const page = ensurePage(url)
      out.push({
        id: randomUUID(), runId, pageId: page.id, scope: 'page', type, severity: SEVERITY[type],
        url, count: s.count, affectedComplete: pageComplete, affectedSource: 'live-scan-anchor',
        detail: null, dedupKey: pageFindingKey(type, url),
      })
    }
  }
  perSource('empty_anchor_text', agg.emptyCount, agg.emptySources)
  perSource('non_descriptive_anchor_text', agg.nonDescriptiveCount, agg.nonDescriptiveSources)

  // single_anchor_variation: SF fires only when > 10; run-scope only.
  if (agg.singleVariationCount > 10) {
    out.push({
      id: randomUUID(), runId, pageId: null, scope: 'run', type: 'single_anchor_variation', severity: 'notice',
      url: null, count: agg.singleVariationCount,
      affectedComplete: !agg.harvestTruncated && !agg.targetsTruncated, affectedSource: 'live-scan-anchor',
      detail: JSON.stringify({ description: DESC.single_anchor_variation, sample: agg.singleVariationTargets }),
      dedupKey: runFindingKey('single_anchor_variation'),
    })
  }
  return out
}
```
Note: match the exact `FindingInput` field set used by `onpage-seo-mapper.ts` (id/runId/pageId/scope/type/severity/url/count/affectedComplete/affectedSource/detail/dedupKey). If `FindingInput` requires additional fields, mirror `onpage-seo-mapper.ts` verbatim.

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run lib/findings/anchor-text-mapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/findings/anchor-text-mapper.ts lib/findings/anchor-text-mapper.test.ts
git commit -m "feat(anchor-text): pure mapAnchorTextFindings (3 findings, SF-faithful)"
```

---

### Task 7: Wire the reducer + mapper into the builder + `anchorSummaryJson`

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts`
- Test: `lib/jobs/handlers/broken-link-verify.*.test.ts` (add an anchor-aware integration test; do NOT touch `broken-link-verify.characterization.test.ts`)

**Interfaces:**
- Consumes: `isNonDescriptiveAnchor` (Task 2), `mapAnchorTextFindings` + `AnchorAggregate` (Task 6), `streamHarvestedLinks` (extend its `onRow` type + select).
- Produces: anchor findings on the live-scan run + `bundle.run.anchorSummaryJson`.

- [ ] **Step 1: Add `anchorText` to the stream select + onRow type**

In `streamHarvestedLinks` (~138-163): add `anchorText: true` to the `select`, add `anchorText: string | null` to the `chunk` row type and to the `onRow` callback param type.

- [ ] **Step 2: Add the bounded reducer state beside `internalPairs` (~272-305)**

```ts
const ANCHOR_TARGET_CAP = 5000
let emptyCount = 0, nonDescCount = 0
const emptySources = new Map<string, number>()
const nonDescSources = new Map<string, number>()
const anchorByTarget = new Map<string, { first: string; multiple: boolean }>()
let anchorTargetsTruncated = false
let anyAnchorData = false
const bump = (m: Map<string, number>, url: string) => {
  const k = normalizeFindingUrl(url)
  if (m.has(k)) m.set(k, m.get(k)! + 1)
  else if (m.size < URLS_PER_FINDING) m.set(k, 1)
}
```
Inside the existing `streamHarvestedLinks(...,['internal-link','image'], (r) => { ... })` callback, in the `if (r.kind === 'internal-link' && !linkStreamRssTripped)` branch, add:
```ts
    if (r.anchorText !== null) {
      anyAnchorData = true
      const a = r.anchorText
      if (a === '') { emptyCount++; bump(emptySources, r.sourcePageUrl) }
      else if (isNonDescriptiveAnchor(a)) { nonDescCount++; bump(nonDescSources, r.sourcePageUrl) }
      if (a !== '') {
        const e = anchorByTarget.get(r.targetUrl)
        if (e) { if (e.first !== a) e.multiple = true }
        else if (anchorByTarget.size < ANCHOR_TARGET_CAP) anchorByTarget.set(r.targetUrl, { first: a, multiple: false })
        else anchorTargetsTruncated = true
      }
    }
```
In the existing `onChunkEnd` RSS-guard block (where `internalPairs.length = 0` on trip), also clear anchor state:
```ts
      emptyCount = 0; nonDescCount = 0; emptySources.clear(); nonDescSources.clear()
      anchorByTarget.clear(); anyAnchorData = false; anchorTargetsTruncated = false
```
Import `isNonDescriptiveAnchor`:
```ts
import { isNonDescriptiveAnchor } from '@/lib/findings/anchor-text-shared'
import { mapAnchorTextFindings, type AnchorAggregate } from '@/lib/findings/anchor-text-mapper'
```

- [ ] **Step 3: Build the aggregate + findings + marker after the stream (near the finding assembly ~653)**

Before the `const findings: FindingInput[] = [...]` array, add:
```ts
  const singleVariationTargets: string[] = []
  for (const [t, v] of anchorByTarget) if (!v.multiple) { if (singleVariationTargets.length < URLS_PER_FINDING) singleVariationTargets.push(t) }
  const singleVariationCount = [...anchorByTarget.values()].filter((v) => !v.multiple).length
  const anchorAgg: AnchorAggregate = {
    emptyCount, emptySources: [...emptySources].map(([url, count]) => ({ url, count })),
    nonDescriptiveCount: nonDescCount, nonDescriptiveSources: [...nonDescSources].map(([url, count]) => ({ url, count })),
    singleVariationCount, singleVariationTargets, harvestTruncated, targetsTruncated: anchorTargetsTruncated,
  }
  const anchorFindings = anyAnchorData ? mapAnchorTextFindings(anchorAgg, { runId, ensurePage }) : []
  const anchorSummaryJson = anyAnchorData
    ? JSON.stringify({ v: 1, targetsObserved: anchorByTarget.size, targetsTruncated: anchorTargetsTruncated, harvestTruncated })
    : null
```
Add `...anchorFindings` to the `findings` array (line ~653). Add `anchorSummaryJson,` to `bundle.run` (line ~898-904).

- [ ] **Step 4: Write the anchor-aware integration test** (new file `broken-link-verify.anchor.test.ts`, following the DB-backed pattern of the existing builder tests)

Seed a SiteAudit + HarvestedLink rows: two internal rows to distinct targets with empty anchors from two source pages, one non-descriptive (`'click here'`), and 11 distinct targets each linked once with a single distinct anchor (to trip >10). Run the builder. Assert the live-scan run's findings include `empty_anchor_text` (count 2), `non_descriptive_anchor_text` (count 1), `single_anchor_variation` (count 11, run-scope), and `anchorSummaryJson` is non-null. Then seed a run with all `anchorText: null` and assert zero anchor findings + `anchorSummaryJson` null.

- [ ] **Step 5: Run the anchor test + the FROZEN characterization (must still pass unchanged)**

Run: `npx vitest run lib/jobs/handlers/broken-link-verify.anchor.test.ts lib/jobs/handlers/broken-link-verify.characterization.test.ts`
Expected: PASS both. The characterization is byte-identical because its fixture rows have `anchorText: null` → `anyAnchorData` false → no findings, `anchorSummaryJson` null.

- [ ] **Step 6: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.anchor.test.ts
git commit -m "feat(anchor-text): builder reducer + mapper wiring + anchorSummaryJson marker"
```

---

### Task 8: AnchorTextSection UI + wiring

**Files:**
- Create: `components/site-audit/AnchorTextSection.tsx`
- Create: `components/site-audit/AnchorTextSection.test.tsx`
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx` (~294-296, after `OnPageSeoSection`)
- Modify: `app/(public)/ada-audit/site/share/[token]/page.tsx` (~84-104, after the on-page section)
- Modify: `app/(app)/ada-audit/site/[id]/page.seo-unavailable.test.tsx` + `app/(public)/.../page.seo-unavailable.test.tsx` (assert AnchorTextSection is absent for placeholder runs)

**Interfaces:**
- Consumes: `ANCHOR_FINDING_TYPE_SET`, `ANCHOR_FINDING_LABELS` (Task 5); the live-scan run's `findings` + `anchorSummaryJson`.

- [ ] **Step 1: Write the failing component test** — `components/site-audit/AnchorTextSection.test.tsx`

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AnchorTextSection } from './AnchorTextSection'

const run = (over: any) => ({ anchorSummaryJson: null, findings: [], ...over }) as any

describe('AnchorTextSection', () => {
  it('not-analyzed when anchorSummaryJson is null', () => {
    const { container } = render(<AnchorTextSection run={run({})} />)
    expect(container.textContent).toMatch(/not analyzed|no anchor/i)
  })
  it('clean when analyzed with zero anchor findings', () => {
    const { container } = render(<AnchorTextSection run={run({ anchorSummaryJson: '{"v":1,"targetsObserved":5}' })} />)
    expect(container.textContent).toMatch(/no anchor-text issues|clean/i)
  })
  it('lists anchor findings', () => {
    const { container } = render(<AnchorTextSection run={run({
      anchorSummaryJson: '{"v":1}',
      findings: [{ scope: 'run', type: 'empty_anchor_text', count: 4, severity: 'warning' }],
    })} />)
    expect(container.textContent).toMatch(/Empty anchor text/)
    expect(container.textContent).toMatch(/4/)
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run components/site-audit/AnchorTextSection.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component** (mirror `OnPageSeoSection.tsx` structure + dark-mode classes)

`components/site-audit/AnchorTextSection.tsx`: accept `{ run }`; if `run == null || run.anchorSummaryJson == null` render the not-analyzed state; filter `run.findings` to `ANCHOR_FINDING_TYPE_SET` run-scope findings; if none → clean state; else a small list of `ANCHOR_FINDING_LABELS[type]` + `count` + severity chip. Follow `OnPageSeoSection`'s markup/classes (card, heading, dark: variants). Client-safe imports only.

- [ ] **Step 4: Wire into both page assemblies**

In `app/(app)/ada-audit/site/[id]/page.tsx`, import `AnchorTextSection` and add after the `<OnPageSeoSection … />` block (~line 297): `<AnchorTextSection run={liveScanRun} />`.
In `app/(public)/ada-audit/site/share/[token]/page.tsx`, add `<AnchorTextSection run={liveScanRun} />` after the on-page section (~line 104), passing the same live-scan run object the other sections use.

- [ ] **Step 5: Update the seo-unavailable guard tests**

In both `page.seo-unavailable.test.tsx` files, add `AnchorTextSection` to the imports and assert `findByType(tree, AnchorTextSection)` is null for a placeholder/seo-unavailable run and non-null for a real live-scan run (mirror the existing `BrokenLinksSection` assertions).

- [ ] **Step 6: Run the component + guard tests**

Run: `npx vitest run components/site-audit/AnchorTextSection.test.tsx "app/(app)/ada-audit/site/[id]/page.seo-unavailable.test.tsx" "app/(public)/ada-audit/site/share/[token]/page.seo-unavailable.test.tsx"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/site-audit/AnchorTextSection.tsx components/site-audit/AnchorTextSection.test.tsx "app/(app)/ada-audit/site/[id]/page.tsx" "app/(public)/ada-audit/site/share/[token]/page.tsx" app/**/page.seo-unavailable.test.tsx
git commit -m "feat(anchor-text): AnchorTextSection on the SEO results tab + share, wired + guarded"
```

---

### Task 9: Full gate run + PR

- [ ] **Step 1: Run the full gates**

Run: `npm run lint && npm test && npm run build`
Expected: tsc clean; full vitest green (incl. the frozen characterization + golden); build succeeds.

- [ ] **Step 2: Smoke (macOS needs CHROME_EXECUTABLE)**

Run: `CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run smoke`
Expected: green (harvest path exercised).

- [ ] **Step 3: Push + open PR** (Claude commits/pushes; verify merged tip + prod source before/after merge per change-control)

```bash
git push -u origin feat/anchor-text-capture
gh pr create --title "feat(sf-retirement): live-scan anchor-text capture + findings parity" --body "<summary + spec/plan links + Codex verdicts>"
```

Deploy + prod-verify (autonomous, gate-green): after merge, `git push` then `ssh $PROD_SSH "~/deploy.sh"`; the Mon 2026-07-27 sweep auto-exercises the harvest → read a real client live-scan run's anchor findings + `anchorSummaryJson`.

---

## Self-Review

**Spec coverage:** §3[1] harvest → Task 3; §3[2] classify/dedup-unchanged → Task 3; §3[3] persist → Task 4; §3b marker → Tasks 1,7; §3[4] reducer → Task 7; §3[5] mapper → Task 6; §3[6] UI → Task 8; §4 schema → Task 1; §5 IssueUnit 'links' → Task 5; §6 invariants → distributed (null/empty Task 4/7, characterization-frozen Task 7, normalization Task 2); §7 tests → each task; shared module + SF refactor → Task 2. No gaps.

**Placeholder scan:** No TBD/TODO; every code step has concrete code; the two lines that say "mirror onpage-seo-mapper/OnPageSeoSection" reference an exact existing file to copy field-for-field (acceptable — the target is concrete and named).

**Type consistency:** `AnchorAggregate` fields identical across Tasks 6 (def) and 7 (construction). `mapAnchorTextFindings(agg, {runId, ensurePage})` signature matches Tasks 6/7. `harvestAnchorsFromDocument` / `classifyTargets(…, anchorPairs)` / `HarvestedTarget.anchorText` consistent across Task 3 and its consumers (Task 4 reads `t.anchorText`; harvest passes pairs). `anchorSummaryJson` / `anchorText` column names match Tasks 1/4/7/8. `IssueUnit: 'links'` added in both `finding-type-sets.ts` and `lib/sweep/types.ts` (Task 5).
