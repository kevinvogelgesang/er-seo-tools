# Viewbook v2 PR7 (Design Pass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mature the public viewbook into a polished, brand-tinted client portal — two-layer sections with scroll-driven reveal, a matured sticky header, a floating TOC rail with search, code-owned SVG accents — and harden the image-upload path with a sharp/webp re-encode pipeline.

**Architecture:** The public seam stays server-rendered (`page.tsx` → `baseRenderSection` → section components → `SectionShell` → `ViewbookShell`). New interactive behaviors live in *small client-island leaves* that the server components render with **serializable props + `children` only** — never function props across the RSC boundary (the Wave-4 P1). `SectionShell` gains a client reveal-wrapper for IntersectionObserver expand/collapse; `ViewbookShell` mounts a new client TOC rail and a matured (still server-rendered) header. All new logic that can be pure is pure and unit-tested; the image pipeline re-encodes to webp inside the existing (unchanged) write/fence path.

**Tech Stack:** Next.js 15 App Router (RSC), React 19, TypeScript, Tailwind (class-based; the PUBLIC viewbook is LIGHT-ONLY — no `dark:`), `sharp` (image re-encode), Vitest (no jest-dom — DOM-native assertions only).

> **Codex plan review applied (session `019f2b57`, gpt-5.6-sol high, 2026-07-17): ACCEPT-WITH-NAMED-FIXES — all 11 fixes folded in below.** Key corrections: preserve `saveViewbookAsset`'s real `{filename, mime}` contract; extract the locally-duplicated `requireBoundedContentLength`; replace the partial per-island dirty-marker scheme with the existing editor registry (`hasActiveEditorActivity()`); give `SectionReveal` the summary+toggle+region ownership + an always-open mode for `pc-intro`; decouple navigation via a custom `vb:navigate` event (not hash-only); add shared anchor builders + render the promised DOM ids; gate the search index to `building` only; thread `stage` into the admin `ThemePreview` too; add a dimension ceiling alongside `limitInputPixels`; profile sharp in a prod-equivalent/controlled window, not a reckless 40 MP stress on the live box; SSR-expanded normal sections + `matchMedia`-in-effect (hydration-safe).

## Global Constraints

- **LIGHT-ONLY public surface.** `ViewbookShell`/`SectionShell`/`ProgressNav`/`EarlierSteps` and every `components/viewbook/public/**` component use NO `dark:` variants. Colors are explicit hex (`bg-[#fafafa]`, `text-[#1a1a1a]`) plus the eight `--vb-*` CSS vars. (Admin `components/viewbook/admin/**` DO use `dark:` — the one admin consumer touched here is `ThemePreview.tsx`, which renders the public `SectionShell` inside a preview canvas.)
- **RSC Server→Client boundary.** `page.tsx`, `ViewbookShell`, `SectionShell`, `ProgressNav`, `EarlierSteps`, all section components, and `baseRenderSection`/`wrappedRenderSection` are SERVER (server→server closures are fine). `OperatorViewbookLayer`, `OperatorSectionWrapper`, and any NEW interactive island are `'use client'`. NEVER pass a function prop from a server component into a client component — pass server-rendered nodes as `children` and only serializable data as props. Keep `app/(public)/viewbook/[token]/page.test.tsx` green (its `:112-121` block asserts `OperatorViewbookLayer` receives no function props and its `children` is a valid element).
- **No jest-dom.** `test/setup-worker.ts` is the only setupFile. Component tests use DOM-native assertions (`toBeTruthy`, `.textContent`, `querySelector`, `.not.toBeNull`, `.getAttribute`) — never `toBeInTheDocument`/`toHaveTextContent`.
- **Hydration-safe client islands.** NEVER read `window.matchMedia`, `document`, or `localStorage` during render or a `useState` initializer — SSR has no `window` and it causes hydration mismatch. Read them in a `useEffect` after mount with an SSR-safe default (mirrors `PresentationToggle`'s `initialized` gate).
- **Array-form `$transaction([...])` only.** No interactive transactions. Raw SQL sets `updatedAt`/timestamps manually (integer ms `Date.now()`). PR7 adds NO new write path — the sharp re-encode is transparent to the existing fenced writes, so the program-wide sync-bump gate is **vacuous** for PR7 (verify in Task 12; no new `syncVersionBump*` call needed).
- **`--vb-*` is the canonical theme namespace** (8 vars, injected by `themeCssVars` in `ThemeStyle.tsx`): `--vb-primary`, `--vb-secondary`, `--vb-tertiary`, `--vb-on-primary`, `--vb-on-secondary`, `--vb-on-tertiary`, `--vb-heading-font`, `--vb-body-font`. All new color/accent styling derives from these — never hardcode brand colors.
- **Presentation-mode coexistence.** `usePresentationMode()` has a safe no-provider default (`{ initialized: true, presenting: false, toggle: () => {} }`) and never throws. New islands must tolerate the anonymous (no-provider) tree. Auto-reveal/TOC behaviors are PUBLIC (orthogonal to the ER layer) and must work in both the anonymous and operator branches.
- **Shell paths with brackets/parens must be quoted** in every shell command (`"app/api/viewbooks/[id]/docs/route.ts"`, `"app/(public)/viewbook/[token]/page.tsx"`) — zsh globs `[id]`/`(public)` otherwise.
- **Gates:** `npx tsc --noEmit`, `npm run lint`, `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`. Never run two vitest suites concurrently in one worktree (shared `.test-dbs/`).

## Visual language (frontend-design)

The viewbook is a **premium, brand-tinted client-onboarding portal**. The aesthetic is *quiet editorial confidence*: generous whitespace, strong typographic hierarchy (the client's chosen heading font as display, body font for reading), full-viewport section spreads with brand-primary header bands (the existing v1 model, matured). The client's own brand color carries the personality — **structure, type, spacing, motion, and accent placement are ours; color is always `--vb-*`.** The signature interaction is the scroll-driven reveal: sections open as they enter the viewport and settle closed as they leave, so the page "breathes." Restraint over spectacle.

**Progressive-enhancement decision (Codex-flagged):** normal sections render **SSR-expanded** — the detail body is present and visible with NO JavaScript (no-JS clients, initial paint, and the reduced-motion path all see full content). After mount, the client island takes over and applies scroll-collapse for out-of-view sections. This accepts a small one-time layout settle on load in exchange for guaranteed content visibility and clean degradation. Never render normal sections collapsed-first.

Concrete design tokens (use verbatim; all light-only and brand-var-driven):

- **Motion:** expand/collapse `260ms cubic-bezier(0.22, 1, 0.36, 1)`; opacity `180ms ease-out`. Reveal uses `grid-template-rows: 0fr → 1fr` on an `overflow:hidden` wrapper (animatable height — NOT `max-height` guesswork). Everything behind `@media (prefers-reduced-motion: reduce)` → `transition: none`.
- **Summary face ("index-card glance"):** a horizontal row inside the brand header band — left: eyebrow (section kind, `--vb-secondary`, 11px letter-spaced uppercase) + headline (`--vb-heading-font`); right: one key number/status chip. Never unmounts (legible while scrolling — only the detail body collapses). The toggle chevron lives on this row.
- **TOC rail:** fixed right edge, `top: 40%`, vertical dot column; each dot `8px`; expands leftward on hover/focus/tap into a translucent card (`background: color-mix(in srgb, var(--vb-primary) 6%, white)`, `1px` border `black/8`) listing labels + ack/done check glyphs. Mobile (`< 768px`): a single FAB opening a bottom-sheet.
- **SVG accents:** thin geometric marks (corner bracket, stacked-dot column, hairline tick divider) — `stroke`/`fill` = `var(--vb-secondary)`/`var(--vb-tertiary)` at `0.35–0.6` opacity; decorative only (`aria-hidden`).
- **Flash-highlight:** target gets `.vb-flash` — `1.2s` brand-tertiary outline pulse (reduced-motion: a static `0.4s` background tint that fades).

---

## Task 1: sharp/webp re-encode pipeline in the asset saver

**Files:**
- Modify: `package.json` (add `sharp` to `dependencies`)
- Modify: `next.config.ts:62` (add `sharp` to `serverExternalPackages`)
- Modify: `lib/viewbook/assets.ts` (raise `MAX_ASSET_BYTES`; re-encode in `saveViewbookAsset`; single-flight queue; dimension ceiling; decode-fail → 400)
- Test: `lib/viewbook/assets.test.ts` (extend — it already exists)

**Interfaces:**
- Consumes: `sniffImageType(buf): 'png'|'jpeg'|'webp'|null` (assets.ts:36), `validateAssetScope` (assets.ts:32), `containedPath(scope, filename): string | null` (assets.ts:59, returns null on bad scope/filename), the inline atomic-write helper.
- Produces: `saveViewbookAsset(scope, buf)` **KEEPS its existing return contract** `Promise<{ filename: string; mime: string }>` — real callers destructure `{ filename }` (`service.ts:630`, `global-content.ts:235`). The filename is now ALWAYS `${uuid}.webp` and `mime` is `'image/webp'`. Throws `HttpError(400, 'invalid_image')` on sniff-fail, oversize, dimension-over-ceiling, OR sharp decode-fail; `HttpError(400, 'invalid_scope')` on bad scope (unchanged). Exported `MAX_ASSET_BYTES = 10 * 1024 * 1024`. New exported `MAX_IMAGE_DIM = 4000`.

Design notes (from the real `assets.ts`):
- Current `saveViewbookAsset` (assets.ts:88-102): `validateAssetScope` guard → `MAX_ASSET_BYTES` (2 MB) → `sniffImageType` → writes bytes verbatim as `${uuid}.${EXT_BY_TYPE[type]}` → returns `{ filename, mime: MIME_BY_TYPE[type] }`. PR7 inserts a sharp decode→webp re-encode between sniff and write; output filename becomes `${uuid}.webp` and mime `'image/webp'`. Existing stored png/jpg files keep serving (the serve route derives Content-Type from the stored extension via `mimeForFilename`; no backfill).
- `sharp` is currently transitive (next → 0.34.5). Add it as a DIRECT dep pinned to the resolved version (`0.34.5`) so `npm install` on the prod box pulls the prebuilt Linux binary.
- Re-encode: decode-bound with `sharp(buf, { limitInputPixels: 40_000_000 })`, then a dimension clamp `.resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: 'inside', withoutEnlargement: true })` (bounds the decoded bitmap AND matches spec §9's "pixel/dimension limits" wording; a legit hero shrinks gracefully, a decode-bomb is rejected by `limitInputPixels` first), then `.webp({ quality: 90 })`. Alpha preserved natively; EXIF/metadata dropped because we never call `.withMetadata()`.
- **Serialize conversions per process:** a module-level single-flight promise chain so two concurrent uploads never hold two decoded bitmaps in RAM at once. (Codex confirmed this pattern is correctly ordered + self-healing after a rejection.)

- [ ] **Step 1: Regenerate the fake-image fixtures first**

The existing `assets.test.ts` (and `service.test.ts`, `global-content.test.ts`, `app/api/viewbooks/**/route.test.ts`) use "PNG magic + zero bytes" buffers. Sharp will now correctly REJECT those. Before touching code, grep for the fake buffers and replace them with real generated images:
```bash
grep -rn "0x89, 0x50\|PNG magic\|Buffer.alloc\|Buffer.from('\\\\x89" lib/viewbook/*.test.ts "app/api/viewbooks" | cat
```
In each suite, generate a valid tiny image once (`await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()`) and use it wherever a real upload must succeed; keep each suite's temp-dir cleanup (`afterAll`/`afterEach`) intact.

- [ ] **Step 2: Write the failing tests** (extend `assets.test.ts`)

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { saveViewbookAsset, MAX_ASSET_BYTES, MAX_IMAGE_DIM, sniffImageType } from './assets'

let pngAlpha: Buffer, jpg: Buffer, webp: Buffer, corrupt: Buffer, huge: Buffer

beforeAll(async () => {
  pngAlpha = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 128, b: 200, alpha: 0.5 } } }).png().toBuffer()
  jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 50, b: 50 } } }).jpeg().toBuffer()
  webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 200, b: 10 } } }).webp().toBuffer()
  corrupt = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage'.repeat(8))]) // PNG magic, undecodable body
  huge = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer()
})

const dir = (scope: string, name: string) => path.join(process.env.VIEWBOOK_ASSETS_DIR ?? 'data/viewbook-assets', scope, name)

describe('saveViewbookAsset webp pipeline', () => {
  it('re-encodes png+alpha → {filename:.webp, mime:image/webp} with alpha preserved', async () => {
    const { filename, mime } = await saveViewbookAsset('global', pngAlpha)
    expect(filename.endsWith('.webp')).toBe(true)
    expect(mime).toBe('image/webp')
    const stored = await readFile(dir('global', filename))
    expect(sniffImageType(stored)).toBe('webp')
    expect((await sharp(stored).metadata()).hasAlpha).toBe(true)
  })
  it('jpg and webp inputs both produce .webp', async () => {
    expect((await saveViewbookAsset('global', jpg)).filename.endsWith('.webp')).toBe(true)
    expect((await saveViewbookAsset('global', webp)).filename.endsWith('.webp')).toBe(true)
  })
  it('strips EXIF metadata', async () => {
    const withExif = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).withExif({ IFD0: { Copyright: 'SECRET' } }).jpeg().toBuffer()
    const { filename } = await saveViewbookAsset('global', withExif)
    expect((await sharp(await readFile(dir('global', filename))).metadata()).exif).toBeUndefined()
  })
  it('clamps oversized dimensions to MAX_IMAGE_DIM (fit inside)', async () => {
    const { filename } = await saveViewbookAsset('global', huge)
    const meta = await sharp(await readFile(dir('global', filename))).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(MAX_IMAGE_DIM)
  })
  it('rejects a corrupt image with 400 invalid_image', async () => {
    await expect(saveViewbookAsset('global', corrupt)).rejects.toMatchObject({ status: 400, code: 'invalid_image' })
  })
  it('rejects an oversize buffer with 400 invalid_image before decoding', async () => {
    await expect(saveViewbookAsset('global', Buffer.alloc(MAX_ASSET_BYTES + 1, 0))).rejects.toMatchObject({ status: 400, code: 'invalid_image' })
  })
  it('rejects a bad scope with 400 invalid_scope (unchanged)', async () => {
    await expect(saveViewbookAsset('../evil', pngAlpha)).rejects.toMatchObject({ status: 400, code: 'invalid_scope' })
  })
  it('MAX_ASSET_BYTES is 10 MB', () => { expect(MAX_ASSET_BYTES).toBe(10 * 1024 * 1024) })
})
```

- [ ] **Step 3: Run — verify fail** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/assets.test.ts` → FAIL.

- [ ] **Step 4: Add sharp as a direct dependency** — `npm install sharp@0.34.5 --save`; verify `package.json` lists `"sharp": "0.34.5"` and `npm ls sharp` shows the direct edge. (RunCloud uses `npm install`, never `npm ci`.)

- [ ] **Step 5: Register sharp in serverExternalPackages** (`next.config.ts:62`):
```ts
serverExternalPackages: ['jsdom', 'axe-core', 'lighthouse', 'pdfjs-dist', 'sharp'],
```

- [ ] **Step 6: Implement the re-encode pipeline in `assets.ts`** (preserving the real contract)

```ts
import sharp from 'sharp'
// ...
export const MAX_ASSET_BYTES = 10 * 1024 * 1024 // 10 MB (PR7 §9)
export const MAX_IMAGE_DIM = 4000              // dimension ceiling alongside limitInputPixels

// Serialize decode→re-encode across the process: two concurrent uploads must
// never hold two decoded bitmaps in RAM at once. Correctly ordered + self-healing
// after a rejection (a rejected run does not poison the chain).
let encodeChain: Promise<unknown> = Promise.resolve()
function serializeEncode<T>(fn: () => Promise<T>): Promise<T> {
  const run = encodeChain.then(fn, fn)
  encodeChain = run.then(() => undefined, () => undefined)
  return run
}
async function reencodeToWebp(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { limitInputPixels: 40_000_000 })
    .rotate() // honor EXIF orientation before stripping metadata
    .resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer()
}
```
Rewrite the body of `saveViewbookAsset` — KEEP `validateAssetScope`, KEEP the `{ filename, mime }` return, KEEP `containedPath`-null handling:
```ts
export async function saveViewbookAsset(scope: string, buf: Buffer): Promise<{ filename: string; mime: string }> {
  if (!validateAssetScope(scope)) throw new HttpError(400, 'invalid_scope')
  if (buf.length > MAX_ASSET_BYTES) throw new HttpError(400, 'invalid_image')
  if (!sniffImageType(buf)) throw new HttpError(400, 'invalid_image')

  let webp: Buffer
  try { webp = await serializeEncode(() => reencodeToWebp(buf)) }
  catch { throw new HttpError(400, 'invalid_image') }

  const filename = `${crypto.randomUUID()}.webp`
  const dest = containedPath(scope, filename)
  if (!dest) throw new HttpError(400, 'invalid_scope')
  await mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp-${crypto.randomUUID()}`
  await writeFile(tmp, webp)
  await rename(tmp, dest)
  return { filename, mime: 'image/webp' }
}
```
(`EXT_BY_TYPE`/`MIME_BY_TYPE` may become unused by this function — grep before removing; the serve path / doc saver may still use them.)

- [ ] **Step 7: Run — verify pass** — `assets.test.ts` all green; then run `service.test.ts` + `global-content.test.ts` to confirm the fixture regeneration (Step 1) kept them green + `npx tsc --noEmit`.

- [ ] **Step 8: Commit**
```bash
git add package.json package-lock.json next.config.ts lib/viewbook/assets.ts lib/viewbook/assets.test.ts lib/viewbook/service.test.ts lib/viewbook/global-content.test.ts
git commit -m "feat(viewbook): PR7 sharp/webp re-encode pipeline for image uploads"
```

---

## Task 2: Extract `requireBoundedContentLength` + add pre-buffer gates to the two image routes

**Files:**
- Modify: `lib/viewbook/route-utils.ts` (add the shared `requireBoundedContentLength(req, maxBytes)`)
- Modify: `"app/api/viewbook-docs/route.ts"` + `"app/api/viewbooks/[id]/docs/route.ts"` (drop the local copies, call the shared one)
- Modify: `"app/api/viewbooks/[id]/assets/route.ts"` + `"app/api/viewbook-content/team-photo/route.ts"` (add the gate + File.size pre-check)
- Test: the four routes' test files (create/extend)

**Interfaces:**
- Consumes: `HttpError`, `fileBufferFromForm(form, maxBytes)` (route-utils.ts:23), `MAX_ASSET_BYTES` (Task 1), `MAX_DOC_BYTES`.
- Produces: `requireBoundedContentLength(request: NextRequest, maxBytes: number): void` — 413 on missing/non-numeric/over-limit `Content-Length`. All four upload routes reject oversize BEFORE `arrayBuffer()`.

Design notes: `requireBoundedContentLength` is currently DUPLICATED locally in both doc routes (`viewbook-docs/route.ts:12`, `viewbooks/[id]/docs/route.ts:23`) with the doc cap baked in. Extract ONE parameterized copy to `route-utils.ts`; the doc callers pass `MAX_DOC_BYTES + 64*1024`, the image callers pass `MAX_ASSET_BYTES + 64*1024` (multipart boundary slack). Both image routes currently call `fileBufferFromForm(form)` with NO `maxBytes` — add the `maxBytes` arg too.

- [ ] **Step 1: Write the failing tests** (per image route; model auth/ctx on the existing route tests)
```ts
it('rejects an over-limit Content-Length with 413 before buffering', async () => {
  const req = new Request('http://x', { method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=b', 'content-length': String(11 * 1024 * 1024) }, body: 'x' })
  expect((await POST(req as any, ctx)).status).toBe(413)
})
it('rejects an over-limit File.size with 413 (valid under-limit Content-Length so the header gate does not fire vacuously)', async () => {
  const big = new File([new Uint8Array(11 * 1024 * 1024)], 'x.png', { type: 'image/png' })
  const form = new FormData(); form.set('kind', 'logo'); form.set('file', big)
  const req = new Request('http://x', { method: 'POST', headers: { 'content-length': '1024' }, body: form as any })
  expect((await POST(req as any, ctx)).status).toBe(413)
})
```
(The File.size test MUST set a small valid `Content-Length` so the header gate passes and the `File.size` check is what fires — otherwise the assertion is vacuous. Codex fix 8.)

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Extract + wire the gate**

In `route-utils.ts` add:
```ts
export function requireBoundedContentLength(request: NextRequest, maxBytes: number): void {
  const raw = request.headers.get('content-length')
  const n = raw == null ? NaN : Number(raw)
  if (!Number.isFinite(n) || n > maxBytes) throw new HttpError(413, 'payload_too_large')
}
```
Replace the local copies in both doc routes with `requireBoundedContentLength(request, MAX_DOC_BYTES + 64 * 1024)` (behavior-preserving). In each image route, before parsing the form:
```ts
requireBoundedContentLength(req, MAX_ASSET_BYTES + 64 * 1024)
const form = await req.formData()
const buf = (await fileBufferFromForm(form, MAX_ASSET_BYTES)) // File.size pre-check inside
```

- [ ] **Step 4: Run — verify pass** (all four route test files, sequenced) + `npx tsc --noEmit`.

- [ ] **Step 5: Commit**
```bash
git add lib/viewbook/route-utils.ts "app/api/viewbook-docs/route.ts" "app/api/viewbooks/[id]/docs/route.ts" "app/api/viewbooks/[id]/assets/route.ts" "app/api/viewbook-content/team-photo/route.ts"
git commit -m "feat(viewbook): PR7 shared requireBoundedContentLength + pre-buffer size gates on image routes"
```

---

## Task 3: Section display-mode helper (the acked-collapse decision + pc-intro always-open)

**Files:**
- Create: `lib/viewbook/section-display.ts` (client-safe pure) + Test `lib/viewbook/section-display.test.ts`

**Interfaces:**
```ts
export type SectionDisplayMode = 'always-open' | 'done' | 'ack-collapsed' | 'normal'
export function sectionDisplayMode(section: PublicSection, stage: ViewbookStage): SectionDisplayMode
export function sectionStartsCollapsed(mode: SectionDisplayMode): boolean   // done || ack-collapsed
export function sectionLocksAutoReveal(mode: SectionDisplayMode): boolean   // done || ack-collapsed || always-open
```

**THE DECISION (spec §4 vs PR5, resolved).** `SectionShell` currently collapses on `state==='done' || acknowledgedAt != null` in EVERY stage, contradicting spec §4 ("in later stages the three sections render in their normal collapsed-carried form regardless of ack state") and mis-collapsing `data-source` (PRIMARY in `building`). **Resolution: ack-driven collapse is gated to `post-contract` only; `done` collapses in every stage.** This makes the spec §4 sentence TRUE as written — no amendment. Carried ackable sections in later stages still collapse via `EarlierSteps`; a primary ackable section (`data-source` in `building`) uses `normal` regardless of a stale `acknowledgedAt`. **`pc-intro` NEVER collapses** (spec §7: "never collapses, no ack button") — it returns `always-open` (Codex fix 4): rendered expanded, no scroll-collapse.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest'
import { sectionDisplayMode, sectionStartsCollapsed, sectionLocksAutoReveal } from './section-display'
import type { PublicSection } from './public-types'
const S = (o: Partial<PublicSection>): PublicSection => ({ sectionKey: 'data-source', state: 'active', doneAt: null, acknowledgedAt: null, introNote: null, narrative: null, ...o })

describe('sectionDisplayMode', () => {
  it('pc-intro is always-open in every stage', () => {
    for (const st of ['post-contract','kickoff','website-specifics','building'] as const)
      expect(sectionDisplayMode(S({ sectionKey: 'pc-intro' }), st)).toBe('always-open')
  })
  it('done collapses in every stage', () => {
    for (const st of ['post-contract','kickoff','website-specifics','building'] as const)
      expect(sectionDisplayMode(S({ state: 'done' }), st)).toBe('done')
  })
  it('ack collapses ONLY in post-contract', () => {
    const acked = S({ acknowledgedAt: 'x' })
    expect(sectionDisplayMode(acked, 'post-contract')).toBe('ack-collapsed')
    expect(sectionDisplayMode({ ...acked, sectionKey: 'data-source' }, 'building')).toBe('normal')
    expect(sectionDisplayMode({ ...acked, sectionKey: 'pc-setup' }, 'kickoff')).toBe('normal')
  })
  it('done wins over ack in post-contract; pc-intro wins over all', () => {
    expect(sectionDisplayMode(S({ state: 'done', acknowledgedAt: 'x' }), 'post-contract')).toBe('done')
    expect(sectionDisplayMode(S({ sectionKey: 'pc-intro', state: 'done' }), 'post-contract')).toBe('always-open')
  })
  it('normal otherwise; collapse/lock predicates', () => {
    expect(sectionDisplayMode(S({}), 'building')).toBe('normal')
    expect(sectionStartsCollapsed('done')).toBe(true); expect(sectionStartsCollapsed('ack-collapsed')).toBe(true)
    expect(sectionStartsCollapsed('always-open')).toBe(false); expect(sectionStartsCollapsed('normal')).toBe(false)
    expect(sectionLocksAutoReveal('always-open')).toBe(true); expect(sectionLocksAutoReveal('normal')).toBe(false)
  })
})
```

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement**
```ts
import type { PublicSection } from './public-types'
import type { ViewbookStage } from './stages'
export type SectionDisplayMode = 'always-open' | 'done' | 'ack-collapsed' | 'normal'
const ALWAYS_OPEN_KEYS = new Set(['pc-intro'])
export function sectionDisplayMode(section: PublicSection, stage: ViewbookStage): SectionDisplayMode {
  if (ALWAYS_OPEN_KEYS.has(section.sectionKey)) return 'always-open'
  if (section.state === 'done') return 'done'
  if (stage === 'post-contract' && section.acknowledgedAt != null) return 'ack-collapsed'
  return 'normal'
}
export function sectionStartsCollapsed(m: SectionDisplayMode): boolean { return m === 'done' || m === 'ack-collapsed' }
export function sectionLocksAutoReveal(m: SectionDisplayMode): boolean { return m !== 'normal' }
```

- [ ] **Step 4: Run — verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(viewbook): PR7 section display-mode helper (ack-collapse gated to post-contract; pc-intro always-open)"`

---

## Task 4: SectionShell v2 — summary face + scroll-reveal client island

**Files:**
- Create: `components/viewbook/public/SectionReveal.tsx` (`'use client'`)
- Modify: `components/viewbook/public/SectionShell.tsx` (server frame; threads `stage`; delegates the summary+toggle+body to `SectionReveal`)
- Modify: every section component that calls `SectionShell` to pass `stage={data.stage}` (welcome, milestones, data-source, brand, assessment, strategy, materials, kickoff-next, ws-intro, pc-intro, pc-setup, pc-invite, pc-thanks) **and** the admin `components/viewbook/admin/ThemePreview.tsx:47` (pass a static `stage="building"`)
- Modify: `components/viewbook/public/useViewbookSync.ts` (export `hasActiveEditorActivity()` — Task 5 depends on it; add here so SectionReveal can import it)
- Test: `components/viewbook/public/SectionReveal.test.tsx`

**Interfaces:**
- Consumes: `sectionDisplayMode`/`sectionStartsCollapsed`/`sectionLocksAutoReveal` (Task 3), `useFocusWithin`/`hasActiveEditorActivity` (useViewbookSync.ts).
- Produces: `SectionShell` gains required prop `stage: ViewbookStage`. It computes `mode = sectionDisplayMode(section, stage)` and renders the brand header band, then a single `<SectionReveal>` that OWNS the summary row (with the toggle), the labelled collapsible region, and the body:
  - `SectionReveal` props (ALL serializable + nodes): `{ sectionKey: SectionKey; title: string; summary?: ReactNode; startCollapsed: boolean; lockAutoReveal: boolean; alwaysOpen: boolean; children: ReactNode }`.
    - `startCollapsed = sectionStartsCollapsed(mode)`, `lockAutoReveal = sectionLocksAutoReveal(mode)`, `alwaysOpen = mode === 'always-open'`.

**Behavior contract (spec §7 + Codex fix 12, refined):**
- SSR/no-JS: `always-open` and `normal` render EXPANDED; `done`/`ack-collapsed` render collapsed. (The reduced-motion path is identical to SSR.)
- After mount, read `prefers-reduced-motion` in a `useEffect` (SSR-safe default `false`).
- **normal** (`!lockAutoReveal`): `IntersectionObserver` (threshold ~0.35) auto-**expands** on enter, auto-**collapses** on leave.
- **always-open:** rendered expanded, no observer, no toggle-driven collapse (the toggle is hidden or a no-op). Never collapses.
- **done / ack-collapsed** (`lockAutoReveal`, `startCollapsed`): start collapsed, never auto-expand; open only on deliberate toggle or a `vb:navigate` event targeting the section. Summary face + celebratory `✓`/"Completed {doneAt}" always visible.
- **Manual wins:** once the user toggles, auto-behavior is disabled for the pageview (`manuallyToggled` ref).
- **Never auto-collapse** when the section holds focus (`useFocusWithin`/`ref.contains(document.activeElement)`) OR `hasActiveEditorActivity()` is true (Codex fix 3 — the registry is global + covers blurred-dirty AND the operator inline editors that render OUTSIDE this DOM). Auto-*expand* is always allowed.
- **reduced-motion:** no transitions, no observer. `always-open`/`normal` → expanded static; `done`/`ack` → collapsed static.
- **`vb:navigate` event** (Task 9): `window.addEventListener('vb:navigate', ...)`; if `detail.sectionKey === sectionKey`, force-expand (deliberate open, even when locked). Also handle the initial `location.hash` on mount (expand the section owning the initial anchor).
- Accessibility: the summary-row toggle button has `aria-expanded` + `aria-controls={regionId}`; the region has `role="region"` + `aria-label={title}` + `data-vb-expanded`. Height via `grid-template-rows: 0fr→1fr` (inline `<style>`, reduced-motion guarded).

- [ ] **Step 1: Write the failing test** (`SectionReveal.test.tsx`; IO + matchMedia mocked; matchMedia default = not-reduced, read in effect)
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { SectionReveal } from './SectionReveal'
import * as sync from './useViewbookSync'

let ioCb: (e: any[]) => void
beforeEach(() => {
  cleanup(); ioCb = () => {}
  ;(globalThis as any).IntersectionObserver = class { constructor(cb: any){ ioCb = cb } observe(){} unobserve(){} disconnect(){} }
  ;(window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener(){}, removeEventListener(){} })
  vi.spyOn(sync, 'hasActiveEditorActivity').mockReturnValue(false)
  window.location.hash = ''
})
const expanded = (r: HTMLElement) => (r.querySelector('[role="region"]') as HTMLElement)?.getAttribute('data-vb-expanded') === 'true'
const base = { title: 'Data Source', summary: <span>sum</span> }

describe('SectionReveal', () => {
  it('normal section: SSR-expanded, collapses on leave, re-expands on enter', () => {
    const { container } = render(<SectionReveal sectionKey="data-source" {...base} startCollapsed={false} lockAutoReveal={false} alwaysOpen={false}><p>body</p></SectionReveal>)
    expect(expanded(container)).toBe(true)                               // SSR/initial expanded
    act(() => ioCb([{ isIntersecting: false, intersectionRatio: 0 }]))
    expect(expanded(container)).toBe(false)                              // leave → collapse
    act(() => ioCb([{ isIntersecting: true, intersectionRatio: 0.6 }]))
    expect(expanded(container)).toBe(true)                              // enter → expand
  })
  it('always-open (pc-intro) never collapses on leave', () => {
    const { container } = render(<SectionReveal sectionKey="pc-intro" title="Welcome" startCollapsed={false} lockAutoReveal alwaysOpen><p>b</p></SectionReveal>)
    act(() => ioCb([{ isIntersecting: false, intersectionRatio: 0 }]))
    expect(expanded(container)).toBe(true)
  })
  it('locked (done/ack) starts collapsed and does not auto-expand', () => {
    const { container } = render(<SectionReveal sectionKey="pc-setup" title="Setup" startCollapsed lockAutoReveal alwaysOpen={false}><p>b</p></SectionReveal>)
    expect(expanded(container)).toBe(false)
    act(() => ioCb([{ isIntersecting: true, intersectionRatio: 0.9 }]))
    expect(expanded(container)).toBe(false)
  })
  it('manual toggle wins over subsequent scroll', () => {
    const { container } = render(<SectionReveal sectionKey="data-source" {...base} startCollapsed={false} lockAutoReveal={false} alwaysOpen={false}><p>b</p></SectionReveal>)
    act(() => (container.querySelector('button[aria-expanded]') as HTMLButtonElement).click()) // manual collapse
    act(() => ioCb([{ isIntersecting: true, intersectionRatio: 0.9 }]))
    expect(expanded(container)).toBe(false)
  })
  it('never auto-collapses while holding focus', () => {
    const { container } = render(<SectionReveal sectionKey="data-source" {...base} startCollapsed={false} lockAutoReveal={false} alwaysOpen={false}><input aria-label="q"/></SectionReveal>)
    ;(container.querySelector('input') as HTMLInputElement).focus()
    act(() => ioCb([{ isIntersecting: false, intersectionRatio: 0 }]))
    expect(expanded(container)).toBe(true)
  })
  it('never auto-collapses while editor activity is reported (operator edits outside this DOM)', () => {
    ;(sync.hasActiveEditorActivity as any).mockReturnValue(true)
    const { container } = render(<SectionReveal sectionKey="data-source" {...base} startCollapsed={false} lockAutoReveal={false} alwaysOpen={false}><p>b</p></SectionReveal>)
    act(() => ioCb([{ isIntersecting: false, intersectionRatio: 0 }]))
    expect(expanded(container)).toBe(true)
  })
  it('reduced-motion: normal renders expanded + static (no observer collapse)', () => {
    ;(window as any).matchMedia = (q: string) => ({ matches: true, media: q, addEventListener(){}, removeEventListener(){} })
    const { container } = render(<SectionReveal sectionKey="brand" {...base} startCollapsed={false} lockAutoReveal={false} alwaysOpen={false}><p>b</p></SectionReveal>)
    expect(expanded(container)).toBe(true)
    act(() => ioCb([{ isIntersecting: false, intersectionRatio: 0 }]))
    expect(expanded(container)).toBe(true)
  })
  it('reduced-motion: locked stays collapsed', () => {
    ;(window as any).matchMedia = (q: string) => ({ matches: true, media: q, addEventListener(){}, removeEventListener(){} })
    const { container } = render(<SectionReveal sectionKey="pc-setup" title="Setup" startCollapsed lockAutoReveal alwaysOpen={false}><p>b</p></SectionReveal>)
    expect(expanded(container)).toBe(false)
  })
  it('vb:navigate to this section force-expands even when locked', () => {
    const { container } = render(<SectionReveal sectionKey="pc-setup" title="Setup" startCollapsed lockAutoReveal alwaysOpen={false}><p>b</p></SectionReveal>)
    act(() => window.dispatchEvent(new CustomEvent('vb:navigate', { detail: { sectionKey: 'pc-setup', anchor: '#pc-setup' } })))
    expect(expanded(container)).toBe(true)
  })
  it('initial-load hash expands the owning section', () => {
    window.location.hash = '#pc-setup'
    const { container } = render(<SectionReveal sectionKey="pc-setup" title="Setup" startCollapsed lockAutoReveal alwaysOpen={false}><p>b</p></SectionReveal>)
    expect(expanded(container)).toBe(true)
  })
})
```

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Add `hasActiveEditorActivity()` to `useViewbookSync.ts`** — a read-only query of the module-level registry (returns true when any registered editor id is active). No behavior change to `registerEditorActivity`/the poller.

- [ ] **Step 4: Implement `SectionReveal.tsx`** per the contract. `expanded` state seeded `!startCollapsed` (SSR-safe — no window read in the initializer); effects: read `matchMedia` (reduced), attach the `IntersectionObserver` (only when `!reduced && !lockAutoReveal`), the auto-collapse guard checks focus + `hasActiveEditorActivity()`, `vb:navigate` + initial-hash listeners. Inline `<style>` for the grid transition + reduced-motion.

- [ ] **Step 5: Rework `SectionShell.tsx`** — add `stage`, compute `mode`, render header band + `<SectionReveal sectionKey title summary startCollapsed lockAutoReveal alwaysOpen>{introNote}{children}</SectionReveal>`. Keep `id={sectionKey}`, `scroll-mt-24` (matured header height, Task 7), `--vb-*` only, light-only. The done/ack celebratory styling becomes summary-face styling.

- [ ] **Step 6: Thread `stage`** into the 13 public section components' `SectionShell` calls AND the admin `ThemePreview.tsx` call (`stage="building"`). For `ThemePreview` (a static preview canvas), pass a normal-mode section so it renders expanded; the observer is harmless in the preview but verify it doesn't loop — if it does, the preview's `SAMPLE_SECTION` staying `state:'active'` + `alwaysOpen=false` + being in-viewport keeps it expanded.

- [ ] **Step 7: Run** the SectionReveal test + all `components/viewbook/public/` + admin ThemePreview tests (update any that asserted the old `<details>` face — to the v2 summary+region structure, NOT weakened) + `npx tsc --noEmit`.

- [ ] **Step 8: Commit**
```bash
git add components/viewbook/public/SectionReveal.tsx components/viewbook/public/SectionShell.tsx components/viewbook/public/useViewbookSync.ts components/viewbook/public/*Section*.tsx components/viewbook/admin/ThemePreview.tsx components/viewbook/public/SectionReveal.test.tsx
git commit -m "feat(viewbook): PR7 SectionShell v2 — summary face + scroll-reveal island (motion, focus/editor-activity guards, always-open)"
```

---

## Task 5: Wire the editor-activity guard end-to-end

**Files:**
- Verify/extend: `components/viewbook/public/useViewbookSync.ts` (`hasActiveEditorActivity()` from Task 4) — confirm every editing island registers activity via `useEditorActivity`/`registerEditorActivity` while dirty/focused/saving.
- Test: `components/viewbook/public/useViewbookSync.test.ts` (extend)

**Interfaces:**
- Produces: `hasActiveEditorActivity(): boolean` reflecting the module-level registry.

Design note (Codex fix 3, replacing the earlier per-island `data-vb-dirty` scheme): the DOM-marker approach was incomplete (omitted `FeedbackThread` + all PR8 inline editors) and structurally unable to see operator editors that render as siblings OUTSIDE `SectionShell`. The registry already tracks dirty/focused/saving for the public islands (PR2). This task confirms coverage and exposes the read-only query — no new per-island attributes.

- [ ] **Step 1: Write the failing/So-far test**
```ts
import { registerEditorActivity, hasActiveEditorActivity, __resetSyncRegistry } from './useViewbookSync'
it('hasActiveEditorActivity reflects the registry', () => {
  __resetSyncRegistry()
  expect(hasActiveEditorActivity()).toBe(false)
  registerEditorActivity('field-1', true); expect(hasActiveEditorActivity()).toBe(true)
  registerEditorActivity('field-1', false); expect(hasActiveEditorActivity()).toBe(false)
})
```

- [ ] **Step 2: Run — verify fail** (if `hasActiveEditorActivity` wasn't fully added in Task 4) → implement/confirm.
- [ ] **Step 3: Audit** the islands (`FieldEditor`, `AmendmentForm`, `TeamInviteForm`, `NotifyEmailsControl`, `MaterialLinkForm`, `FeedbackThread`) — confirm each calls `useEditorActivity(id, isDirtyOrFocusedOrSaving)`. Add any missing registration.
- [ ] **Step 4: Run — verify pass** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(viewbook): PR7 expose hasActiveEditorActivity() so scroll-reveal never collapses active edits"`

---

## Task 6: Rich summary faces for key sections (+ generic default for all)

**Files:**
- Create: `lib/viewbook/summary-metrics.ts` (pure) + Test `lib/viewbook/summary-metrics.test.ts`
- Create: `components/viewbook/public/SummaryStat.tsx` (server; eyebrow + headline + number/status chip, `--vb-*`, light-only)
- Modify: `MilestonesSection.tsx`, `DataSourceSection.tsx`, `BrandSection.tsx`, `MaterialsSection.tsx`, `PcInviteSection.tsx`, `StrategySection.tsx` (rich summaries); every other section gets a generic `SummaryStat` (title + one-line status) so NO section is missing a summary face.

**Interfaces:**
```ts
export function milestoneProgress(m: PublicMilestone[]): { done: number; total: number }
export function answeredProgress(cats: PublicFieldCategory[]): { answered: number; total: number } // value non-empty/non-whitespace
export function inviteProgress(members: PublicTeamMember[]): { invited: number; total: number }
export function docCount(docs: { global: PublicDocRow[]; own: PublicDocRow[] }): number
```
`BrandSection`'s summary = three brand swatches (primary/secondary/tertiary) — the "key visual." **pc-invite copy = "N invite(s) requested"** (NOT "sent" — `PublicTeamMember.invited` means a delivery row exists, not that Mailgun sent; Codex fix 9).

- [ ] **Step 1: Write the failing test**
```ts
import { milestoneProgress, answeredProgress, inviteProgress, docCount } from './summary-metrics'
it('milestoneProgress', () => expect(milestoneProgress([{status:'done'} as any,{status:'current'} as any])).toEqual({done:1,total:2}))
it('answeredProgress ignores empty/whitespace', () => expect(answeredProgress([{category:'s',fields:[{value:'x'} as any,{value:' '} as any,{value:null} as any]}] as any)).toEqual({answered:1,total:3}))
it('inviteProgress', () => expect(inviteProgress([{invited:true} as any,{invited:false} as any])).toEqual({invited:1,total:2}))
it('docCount', () => expect(docCount({global:[{},{}] as any,own:[{}] as any})).toBe(3))
```
- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement** the pure metrics + `SummaryStat`; wire the six rich summaries + generic default in the remaining sections.
- [ ] **Step 4: Run — verify pass** (metrics + updated section tests) + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(viewbook): PR7 summary faces (rich for key sections, generic default elsewhere)"`

---

## Task 7: Matured header (ProgressNav v2 — stage stepper + CSM chip)

**Files:**
- Modify: `components/viewbook/public/ProgressNav.tsx` (stays SERVER)
- Create: `lib/viewbook/stage-progress.ts` + `lib/viewbook/csm-chip.ts` (pure) + their tests
- Test: `components/viewbook/public/ProgressNav.test.tsx` (extend)

**Interfaces:**
```ts
export function stageSteps(current: ViewbookStage): { key: ViewbookStage; label: string; state: 'done'|'current'|'upcoming' }[]
export function resolveCsmChip(team: TeamMember[] | null | undefined, csmName: string | null):
  { name: string; role: string; photo: string | null; email: string | null } | null // m.isCsm && m.name===csmName
```
ProgressNav v2 renders: logo (or displayName fallback) + displayName · a 4-step stage stepper (done/current/upcoming, `--vb-*`) · CSM chip (photo via `publicAssetUrl(token, chip.photo)`, name, `mailto:` when email present). Section anchor dots MOVE to the TOC rail (Task 9) — ProgressNav v2 renders no section dots. `sticky top-0 z-40`, light-only. `resolveCsmChip` accepts `TeamMember[] | null | undefined` (Codex fix 9).

- [ ] **Step 1: Write failing tests**
```ts
import { stageSteps } from './stage-progress'; import { resolveCsmChip } from './csm-chip'
it('stageSteps marks prior done, current, later upcoming', () => {
  expect(stageSteps('website-specifics').map(s=>s.state)).toEqual(['done','done','current','upcoming'])
})
it('resolveCsmChip matches isCsm by name; null on no-match/no-name/no-roster/null-roster', () => {
  const team = [{name:'Pat',role:'CSM',photo:'p.webp',isCsm:true,email:'pat@er.com',blurb:''}]
  expect(resolveCsmChip(team,'Pat')).toEqual({name:'Pat',role:'CSM',photo:'p.webp',email:'pat@er.com'})
  expect(resolveCsmChip(null,'Pat')).toBeNull(); expect(resolveCsmChip(undefined,'Pat')).toBeNull()
  expect(resolveCsmChip([{name:'Pat',role:'x',photo:null,isCsm:false,blurb:''}],'Pat')).toBeNull()
  expect(resolveCsmChip(team,null)).toBeNull()
})
```
Plus a DOM-native `ProgressNav.test.tsx`: CSM chip renders a `mailto:` anchor when email present; the stepper marks the current stage; NO section anchor dots; no `dark:` classes.
- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement** the two pure modules; rebuild `ProgressNav.tsx` (stepper + CSM chip, section-dot `<ul>` removed); thread `token` + `team` in from `ViewbookShell` (serializable). Light-only.
- [ ] **Step 4: Run — verify pass** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(viewbook): PR7 matured header — stage stepper + CSM chip"`

---

## Task 8: Shared anchors + TOC/search index builders (pure)

**Files:**
- Create: `lib/viewbook/anchors.ts` (client-safe shared anchor builders) + Test
- Create: `lib/viewbook/toc-index.ts` (pure) + Test
- Create: `lib/viewbook/category-labels.ts` (relocate `CATEGORY_LABELS` out of `DataSourceSection.tsx`, import in both)

**Interfaces:**
```ts
// anchors.ts — the ONE home so index + rendering can't drift (Codex fix 6)
export const sectionAnchor = (k: SectionKey) => `#${k}`
export const categoryAnchor = (cat: string) => `#vb-cat-${cat}`
export const fieldAnchor = (id: number) => `#vb-field-${id}`
export const milestoneAnchor = (id: number) => `#vb-milestone-${id}`
export const materialAnchor = (id: number) => `#vb-material-${id}`
export const docAnchor = (filename: string) => `#vb-doc-${filename}`
// toc-index.ts
export interface TocEntry { sectionKey: SectionKey; label: string; anchor: string; done: boolean; acked: boolean; children?: { label: string; anchor: string }[] }
export interface SearchEntry { id: string; kind: 'section'|'qa'|'milestone'|'material'|'doc'; label: string; sectionKey: SectionKey; anchor: string; haystack: string }
export function buildTocIndex(data: ViewbookPublicData): TocEntry[]      // primary sections in flow order; building → data-source gets category sub-entries
export function buildSearchIndex(data: ViewbookPublicData): SearchEntry[] // ONLY content from VISIBLE sections (Codex fix 7)
export function fuzzyScore(query: string, haystack: string): number      // 0 = no match; subsequence + contiguity + word-start bonus
export function searchViewbook(index: SearchEntry[], query: string, limit?: number): SearchEntry[]
```
`buildTocIndex` uses `data.primarySections` (lineup order), labels from `SECTION_TITLES`, `done = state==='done'`, `acked = acknowledgedAt != null`. In `building` the `data-source` entry gains `children` = one per `fieldCategory` (`CATEGORY_LABELS[c.category] ?? c.category`, `categoryAnchor(c.category)`). `buildSearchIndex` emits entries ONLY for sections present in `data.primarySections`/`data.carriedSections` (never leak content from a section not rendered): `section` (title), `qa` (`field.label` [+ value], `fieldAnchor(id)`), `milestone` (`title`+`blurb`, `milestoneAnchor(id)`), `material` (`label`, `materialAnchor(id)`), `doc` (`title`+`blurb`, `docAnchor(filename)`). `fuzzyScore` dependency-free (case-insensitive subsequence; contiguity + word-start bonuses). `searchViewbook` filters `>0`, sorts desc, caps `limit ?? 20`.

- [ ] **Step 1: Write the failing tests** (anchors round-trip; buildTocIndex building sub-entries; buildSearchIndex covers all 5 kinds + excludes non-visible-section content; fuzzyScore ranking; searchViewbook anchors).
- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement** `anchors.ts`, `category-labels.ts` (+ update `DataSourceSection.tsx` import), `toc-index.ts`.
- [ ] **Step 4: Run — verify pass** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(viewbook): PR7 shared anchors + TOC/fuzzy-search index builders (visible-section-scoped)"`

---

## Task 9: Floating TOC rail island + navigation + DOM anchors

**Files:**
- Create: `components/viewbook/public/viewbook-navigate.ts` (client util: dispatch `vb:navigate`, scroll, flash — dependency-free)
- Create: `components/viewbook/public/TocRail.tsx` (`'use client'`)
- Modify: `DataSourceSection.tsx` (render `id` on each category via `categoryAnchor` and each field via `fieldAnchor`), `MilestonesSection.tsx` (`milestoneAnchor`), `MaterialsSection.tsx` (`materialAnchor`), `StrategySection.tsx` (`docAnchor`) — the DOM ids the search index promises (Codex fix 6)
- Test: `components/viewbook/public/TocRail.test.tsx`

**Interfaces:**
- Consumes: `TocEntry[]`/`SearchEntry[]` (Task 8, serializable), `searchViewbook`, `navigateToAnchor`.
- Produces:
```ts
// viewbook-navigate.ts
export function navigateToAnchor(sectionKey: SectionKey, anchor: string): void
// dispatches CustomEvent('vb:navigate', { detail: { sectionKey, anchor } }) so the owning
// SectionReveal force-expands FIRST, then (rAF/next tick) scrollIntoView + adds .vb-flash to the anchor target.
```
`TocRail` props (ALL serializable): `{ toc: TocEntry[]; searchIndex: SearchEntry[]; verbose: boolean }`. No function props. Rendered by `ViewbookShell` (server) as a client leaf.

Behavior (spec §7): fixed right edge, dots → labeled card on hover/focus/tap; each entry shows a done/acked glyph (`done` filled `--vb-tertiary`; `acked` hollow `--vb-secondary`). Activate → `navigateToAnchor(entry.sectionKey, entry.anchor)`. **Keyboard:** `role="navigation"`, roving-tabindex list, ArrowUp/Down move focus, Enter/Space activate, Escape collapses + returns focus to the trigger. **Mobile (`< 768px`, read via `matchMedia` in an EFFECT — SSR-safe default desktop):** a `data-vb-toc-fab` button opening a bottom-sheet with the same entries. **Search (verbose only):** `input[type=search]` filters via `searchViewbook`; a hit → `navigateToAnchor(hit.sectionKey, hit.anchor)`. Presentation-agnostic (public; reads nothing operator-only).

- [ ] **Step 1: Write the failing test** (DOM-native; matchMedia mocked in effect; `vb:navigate` captured)
```tsx
const toc = [
  { sectionKey:'welcome', label:'Welcome & Team', anchor:'#welcome', done:true, acked:false },
  { sectionKey:'data-source', label:'Data Source', anchor:'#data-source', done:false, acked:true, children:[{label:'Programs',anchor:'#vb-cat-programs'}] },
] as any
const searchIndex = [{ id:'doc-a', kind:'doc', label:'Playbook', sectionKey:'strategy', anchor:'#vb-doc-a.webp', haystack:'playbook' }] as any
// tests: 2 entries with done+acked glyphs; activating an entry dispatches vb:navigate with its {sectionKey,anchor};
// verbose shows the Programs sub-entry + a search box that filters to the doc hit and navigates;
// ArrowDown moves roving focus; Escape collapses; mobile matchMedia→FAB present; SSR render (no window) does not throw.
```
- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement** `viewbook-navigate.ts` (respect reduced-motion for the flash) + `TocRail.tsx`; add the DOM `id`s to the four section components via the shared anchor builders. Light-only, `--vb-*`. Inline `<style>` for `.vb-flash` + rail transitions (reduced-motion guarded).
- [ ] **Step 4: Run — verify pass** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit**
```bash
git add components/viewbook/public/TocRail.tsx components/viewbook/public/viewbook-navigate.ts components/viewbook/public/TocRail.test.tsx components/viewbook/public/DataSourceSection.tsx components/viewbook/public/MilestonesSection.tsx components/viewbook/public/MaterialsSection.tsx components/viewbook/public/StrategySection.tsx
git commit -m "feat(viewbook): PR7 TOC rail — dots/labels, ack-done glyphs, keyboard nav, mobile sheet, building search, vb:navigate + anchors"
```

---

## Task 10: Code-owned SVG accents

**Files:**
- Create: `components/viewbook/public/SectionAccents.tsx` (server; `aria-hidden` inline SVG) + Test
- Modify: `SectionShell.tsx` / `EarlierSteps.tsx` (place accents — decorative only)

**Interfaces:** `CornerBracket`, `TickDivider`, `DotStack` — pure server components, inline SVG, `fill`/`stroke` = `var(--vb-secondary)`/`var(--vb-tertiary)` at reduced opacity, all `aria-hidden="true"`, no client JS, light-only.

- [ ] **Step 1: Write the failing test**
```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { CornerBracket, TickDivider, DotStack } from './SectionAccents'
it('accents are aria-hidden, tint via --vb-*, no dark:', () => {
  for (const el of [<CornerBracket key="a"/>, <TickDivider key="b"/>, <DotStack key="c"/>]) {
    const h = renderToStaticMarkup(el); expect(h).toContain('aria-hidden'); expect(h).toContain('var(--vb-'); expect(h).not.toContain('dark:')
  }
})
```
- [ ] **Step 2–4:** implement + place + verify pass + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(viewbook): PR7 code-owned SVG accents tinted via --vb-* vars"`

---

## Task 11: Wire rail + header into ViewbookShell; restyle EarlierSteps; verify RSC composition

**Files:**
- Modify: `components/viewbook/public/ViewbookShell.tsx` (mount `TocRail`; pass `token`+`team` to `ProgressNav`; build indexes server-side; **search index + verbose gated to `building`**)
- Modify: `components/viewbook/public/EarlierSteps.tsx` (v2 restyle — "PR7 restyles"; same `renderSection` reuse, light-only)
- Modify (if needed): `"app/(public)/viewbook/[token]/page.tsx"` (NO new function props)
- Test: `components/viewbook/public/ViewbookShell.test.tsx`; confirm `"app/(public)/viewbook/[token]/page.test.tsx"` stays green

**Interfaces:** `ViewbookShell` renders `<ProgressNav … token={token} team={data.global.team}/>` + primary flow + `<EarlierSteps/>` + `<TocRail toc={buildTocIndex(data)} searchIndex={data.stage === 'building' ? buildSearchIndex(data) : []} verbose={data.stage === 'building'} />`. **Outside `building`, the search index is `[]`** (Codex fix 7 — don't serialize Q&A values into stages where those sections aren't the searchable focus). `TocRail` is a client leaf inside the SERVER `ViewbookShell` — safe in BOTH branches (anonymous root; operator `children` of `OperatorViewbookLayer`). No function props cross into any client island.

- [ ] **Step 1: Write the test** — `ViewbookShell.test.tsx`: building data renders `data-vb-toc-entry`s + a verbose search box; a non-building stage renders the rail but NO search box and an empty search index (assert e.g. no `input[type="search"]`).
- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement** the wiring (indexes built server-side, `building`-gated), restyle `EarlierSteps`, thread `token`/`team`. No function into a client island. Keep the sr-only h1 + footer.
- [ ] **Step 4: Run the RSC guard + full public seam** — `DATABASE_URL="file:./local-dev.db" npx vitest run "app/(public)/viewbook/[token]/page.test.tsx" components/viewbook/public/`. Confirm `page.test.tsx`'s operator test still asserts `OperatorViewbookLayer` has NO function props and `isValidElement(props.children)`.
- [ ] **Step 5: Commit**
```bash
git add components/viewbook/public/ViewbookShell.tsx components/viewbook/public/EarlierSteps.tsx components/viewbook/public/ViewbookShell.test.tsx "app/(public)/viewbook/[token]/page.tsx"
git commit -m "feat(viewbook): PR7 wire TOC rail + matured header into ViewbookShell; restyle EarlierSteps"
```

---

## Task 12: Full gates, sync-bump audit, sharp profiling, reviews, merge

- [ ] **Step 1: Full local gates** — `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`. Record counts in the SDD ledger.

- [ ] **Step 2: Sync-bump audit (expected VACUOUS)** — grep the branch diff for any NEW mutating write path. PR7 adds none: the sharp re-encode is transparent to `saveViewbookAsset`'s callers (theme/hero/photo/doc writes still bump inside their existing fenced txns; the image-route size gates add no write). Codex confirmed this. **State: "PR7 sync-bump audit = 0 new rendered-data mutations (vacuous), matching PR6."** If a new write path appears, STOP and add the bump + bump/no-bump tests.

- [ ] **Step 3: Profile the sharp decode on a prod-equivalent target (deploy prereq — Codex fix 10)**

Profile the CLAMPED max-dimension re-encode (a `MAX_IMAGE_DIM²`-bounded bitmap, ~16 MP — NOT a reckless 40 MP stress) on Node 22 Linux. **Do NOT run an unbounded stress conversion on the LIVE 3.9 GB prod host** (it has OOM'd twice). Options, in preference order: (a) a prod-equivalent Linux/Node-22 container/staging process; (b) the live box ONLY during an explicitly controlled low-traffic maintenance window, with a single bounded decode. Resolve `$PROD_SSH` from `docs/SERVER_SETUP.md`. Time a `sharp(sixKpng, { limitInputPixels: 40_000_000 }).resize(4000,4000,{fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer()` and print elapsed ms + peak RSS. Confirm it completes well under the route timeout and does not spike RSS. Record numbers in the SDD ledger. (The prebuilt sharp 0.34.5 Linux binary matches Next's transitive version already on the box.)

- [ ] **Step 4: Whole-branch review** — freshest capable model (Fable if available; opus if Fable still 5h-limited — check first). Focus: RSC boundary (no fn props into client islands; `page.test.tsx` guard), motion-rule correctness (reduced-motion, manual-wins, focus/editor-activity guards, always-open pc-intro), sharp pipeline (decode bound + dimension clamp, single-flight, decode-fail→400, alpha/EXIF), light-only (0 `dark:` in public components), the acked-collapse decision, navigation (vb:navigate nested/initial-hash), search-index building-only gating. Fix Critical/Important; re-gate.

- [ ] **Step 5: `codex exec review --base main`**
```bash
cd .claude/worktrees/viewbook-v2-pr7
codex exec review --base main -m <MODEL>   # MODEL per the budget snapshot; run via cd (no --cd)
```
Verdict = the final `codex` message block (grep/tail; output echoes files). Fix P1 + valid P2. Re-gate.

- [ ] **Step 6: Merge** — push, open PR, gates green, merge (merge commit per program convention). Record merge commit + gate counts in the SDD ledger.

---

## Self-review checklist (run before dispatching)

1. **Spec coverage:** §7 SectionShell v2 (T4)·summary faces (T4/T6)·motion rules (T4)·matured header (T7)·TOC rail + building-verbose + search (T8/T9/T11)·SVG accents (T10)·pc-intro-never-collapses (T3/T4). §9 sharp/webp + dimension bound (T1)·image-route caps (T2)·serverExternalPackages (T1)·PDFs unchanged (verified untouched in T12). §4 acked-collapse decision (T3). RSC composition (T4/T11/T12). Sync-bump gate (T12). ✅
2. **Codex fixes folded:** (1) saveViewbookAsset `{filename,mime}` contract T1; (2) fixture regen T1.S1; (3) editor-registry guard T4/T5; (4) SectionReveal owns summary+toggle+region + always-open T4; (5) vb:navigate + initial-hash T4/T9; (6) shared anchors + rendered ids T8/T9; (7) search index building-only T8/T11; (8) requireBoundedContentLength extraction + valid Content-Length test + quoted paths T2; (9) ThemePreview stage + resolveCsmChip nullable + generic summary + "invite requested" T4/T6/T7; (10) dimension ceiling + safe profiling T1/T12; (11) stronger interaction tests + matchMedia-in-effect T4/T9. ✅
3. **No placeholders:** pure-logic tasks carry full code; component tasks carry real DOM-native test bodies + concrete prop contracts. Exact accent SVG paths (T10) + per-section summary copy (T6) are visual detail within pinned tokens — not logic placeholders. ✅
4. **Type consistency:** `sectionDisplayMode`/`sectionStartsCollapsed`/`sectionLocksAutoReveal` (T3) → SectionShell/SectionReveal (T4); `hasActiveEditorActivity` (T4) consumed by SectionReveal + confirmed T5; `anchors.ts` (T8) used by toc-index (T8) + section components (T9); `TocEntry`/`SearchEntry` (T8) → TocRail (T9) + ViewbookShell (T11); `resolveCsmChip` nullable roster matches `TeamMember`. ✅
5. **RSC guard:** no task introduces a function prop into a client island; `TocRail`/`SectionReveal` take serializable props + nodes; `ProgressNav` stays server; `page.test.tsx:112-121` re-run T11/T12. ✅
