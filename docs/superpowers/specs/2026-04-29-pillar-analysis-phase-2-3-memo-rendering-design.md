# Pillar Analysis Phase 2.3 — Strategic Memo Rendering

**Date:** 2026-04-29
**Branch:** `feature/pillar-analysis-phase-1`
**Predecessors:** Phase 1 (deterministic backbone), Phase 2.1 (clipboard prompt UX), Phase 2.2 (skill artifact + narrative writeback)
**Status:** Design — pending implementation plan

---

## 1. Background

Phase 2.2 added the ability for analysts to copy a clipboard payload from the dashboard, paste it into Claude Desktop where the `pillar-analysis-narrative` skill activates, generate a strategic memo, and PATCH it back to the analysis row via `aiNarrative`. The PATCH endpoint and skill are shipped.

What is missing: the dashboard at `/pillar-analysis/[id]` does not render the memo. Today, an analyst has to query the GET endpoint or read the SQLite row directly to see the output of their own skill run. This is Phase 2.3.

This phase is UI-only — no new auth surfaces, no schema changes, no skill changes, no contract changes.

## 2. Goals

1. Display the markdown memo on the dashboard when `aiNarrative` is non-null.
2. Show a clear instructional hint when `aiNarrative` is null.
3. Show a relative-time staleness indicator (`narrativeUpdatedAt`) so analysts can tell at a glance whether the memo is fresh.
4. Auto-refresh the dashboard the first time a memo arrives, so the analyst doesn't have to manually reload after a skill run.
5. Relabel the existing header button to "Regenerate via Claude" when a memo already exists, signaling that re-running the action will overwrite.
6. Add a sticky page-section nav so the now-tall page stays navigable.

## 3. Non-goals

- "What would you like to change?" textarea on regenerate. Out of scope; would require changes to the prompt format contract and the skill. Deferred to Phase 3+.
- Narrative version history / diffs.
- Server-side relative-time formatting.
- Any changes to `docs/pillar-prompt-contract.md` or `skills/pillar-analysis-narrative/`.
- Polling for updates on already-present memos (regenerations require a manual refresh — acceptable since the analyst is in the regenerate flow when that happens).
- Pixel-snapshot tests of the memo card.

## 4. User-visible behavior

### 4.1 Page layout (top to bottom)

1. **Sticky section nav** — a thin bar at `position: sticky; top: 0` with anchor links: `Score · Memo · Hub · Pillars · URLs`. Each section gets a matching `id`. The nav is always visible (does not hide based on memo presence).
2. Header (existing) — title, generated-at, "Copy Claude Prompt" / "Regenerate via Claude" button.
3. DataCompletenessBanner (existing, conditional).
4. Score grid (existing) — ScoreCard + SubscoreBreakdown.
5. **Strategic Memo card** (new) — placed between the Score grid and HubRecommendationCard.
6. HubRecommendationCard (existing).
7. PillarTopicList (existing).
8. UrlVerdictTable (existing).

### 4.2 Memo card states

**Has memo** (`aiNarrative` is a non-empty string):
- Card header: "Strategic Memo" title on the left; on the right, "Updated 3 hours ago" rendered as relative time, with the absolute timestamp as a `title` attribute (browser tooltip on hover).
- Body: the markdown rendered via `react-markdown` with hand-rolled component overrides matching the dashboard's typography (font-display headers, navy palette, dark-mode variants).
- Always renders full — no max-height, no expand/collapse. The memo is the strategic read; collapsing it would hide the value.

**No memo** (`aiNarrative` is null):
- Card header: "Strategic Memo".
- Body: a single instructional hint — "Strategic memo not yet generated. Click **Copy Claude Prompt** above and paste it into Claude Desktop. The memo will appear here automatically."
- A `MemoPoller` client component is mounted to detect arrival (see §4.4).

### 4.3 Header button relabeling

`CopyClaudePromptButton` accepts a new `hasMemo: boolean` prop:
- `false` → label is "Copy Claude Prompt" (current behavior).
- `true` → label is "Regenerate via Claude".

Action is unchanged in both cases (mint token + copy payload). Only the label changes.

### 4.4 Auto-refresh after memo arrival

When the page is rendered with `aiNarrative === null`, a client component `MemoPoller` mounts and:
1. Polls `GET /api/pillar-analysis/by-session/[sessionId]` every 3 seconds.
2. Pauses when `document.visibilityState === 'hidden'` (analyst switched tabs or minimized). Resumes on `visible`.
3. Stops permanently the first time the response contains a non-null `aiNarrative`.
4. On detection, calls Next.js `router.refresh()` to re-fetch server data and re-render. The `StrategicMemoCard` then renders the has-memo state on the next paint.

The poller component is mounted ONLY on the pillar-analysis dashboard page, ONLY when no memo is present. It is not mounted on the audit page, the home page, or any other route. There is no global polling.

## 5. Architecture

### 5.1 New components

| File | Type | Responsibility |
|---|---|---|
| `app/pillar-analysis/[id]/components/StrategicMemoCard.tsx` | Server Component | Top-level card. Branches on `aiNarrative` presence. Renders `MemoMarkdown` + `RelativeTime` (has-memo) or hint text + `MemoPoller` (null). |
| `app/pillar-analysis/[id]/components/MemoMarkdown.tsx` | Client Component | Wraps `react-markdown` with custom component overrides for `h2`, `h3`, `p`, `ul`, `ol`, `li`, `strong`, `em`. Default sanitization (no `rehype-raw`). |
| `app/pillar-analysis/[id]/components/MemoPoller.tsx` | Client Component | Polls the by-session endpoint while memo is null. Pauses on tab hidden. Calls `router.refresh()` on arrival. Mounted only when needed. |
| `app/pillar-analysis/[id]/components/RelativeTime.tsx` | Client Component | Tiny utility. Renders `<span title={absolute}>{relative}</span>`. Re-computes relative every 60s. Avoids hydration mismatch by rendering absolute on first paint, then upgrading to relative after mount. |
| `app/pillar-analysis/[id]/components/SectionNav.tsx` | Client Component | Sticky nav bar with anchor links. Client because we may add active-section highlighting via `IntersectionObserver` later (deferred — V1 is dumb anchor links). |

### 5.2 Modified files

| File | Change |
|---|---|
| `app/pillar-analysis/[id]/page.tsx` | Pass `aiNarrative`, `narrativeUpdatedAt`, and `pa.session.id` to `StrategicMemoCard`. Wire `hasMemo={!!pa.aiNarrative}` to `CopyClaudePromptButton`. Add `id` attributes to each major section (`#score`, `#memo`, `#hub`, `#pillars`, `#urls`). Mount `SectionNav` at the top. |
| `app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx` | Add `hasMemo: boolean` prop. Render contextual label. No other change. |
| `app/api/pillar-analysis/by-session/[sessionId]/route.ts` | Add `aiNarrative` and `narrativeUpdatedAt` to the response payload. Already-public endpoint, same row. Update the response type. |
| `package.json` | Add `react-markdown` dependency. |

### 5.3 Dependencies

- `react-markdown` (~30KB, MIT). Sole new dependency. We do NOT add `rehype-raw` (we never want raw HTML in the memo) and we do NOT add `remark-gfm` unless the memo schema turns out to need GFM features (tables, task lists, strikethrough). Today's schema is plain markdown and does not need GFM.

### 5.4 Data flow

```
Server render (page.tsx)
  → fetch PillarAnalysis row from Prisma
  → pass aiNarrative + narrativeUpdatedAt to StrategicMemoCard
  → StrategicMemoCard branches:
      has memo → MemoMarkdown + RelativeTime
      null     → instructional hint + MemoPoller

Client (when memo is null)
  MemoPoller (every 3s, paused when tab hidden)
    → GET /api/pillar-analysis/by-session/[sessionId]
    → if response.aiNarrative != null:
        → router.refresh()
        → unmount (next render has the memo, no poller mounted)
```

## 6. API change detail

`GET /api/pillar-analysis/by-session/[sessionId]` is a public, trimmed endpoint used by the audit-page polling button. Its current response includes status, score, and a few summary fields. We add two fields:

```ts
{
  // ... existing fields
  aiNarrative: string | null,
  narrativeUpdatedAt: string | null  // ISO 8601
}
```

This is additive. No auth change. No new endpoint. The new fields are read-only views of public-row data already accessible via the same endpoint's `id`-based sibling.

## 7. Markdown rendering — component overrides

`MemoMarkdown` passes a `components` map to `react-markdown`. Each override returns the equivalent semantic element with dashboard classes:

| Markdown element | Rendered as |
|---|---|
| `h2` | `<h2>` with `font-display font-bold text-xl text-[#1c2d4a] dark:text-white mt-6 first:mt-0` |
| `h3` | `<h3>` with `font-display font-semibold text-lg text-[#1c2d4a] dark:text-white mt-4` |
| `p` | `<p>` with `text-gray-700 dark:text-white/80 mt-2 leading-relaxed` |
| `ul` | `<ul>` with `list-disc ml-6 mt-2 space-y-1` |
| `ol` | `<ol>` with `list-decimal ml-6 mt-2 space-y-1` |
| `li` | `<li>` with `text-gray-700 dark:text-white/80` |
| `strong` | `<strong>` with `font-semibold text-[#1c2d4a] dark:text-white` |
| `em` | `<em>` with `italic` |

Specific values may be tuned during implementation by visually comparing against `HubRecommendationCard` and `ScoreCard`, but the principle is fixed: match the existing dashboard typography, do not import `@tailwindcss/typography`'s `prose` styles.

## 8. Sticky nav

`SectionNav` renders inline as the first child of `<main>`, with `position: sticky; top: 0; z-index: 10; backdrop-blur` and a thin border-bottom in dark/light. Anchor links use `<a href="#score">` etc. — native browser anchor scrolling, no JavaScript scroll-handling. Highlighting the active section based on viewport position is deferred — V1 is plain links.

When the memo is null, the `#memo` anchor still exists (the card is still rendered, just in null state) so the link is not broken.

## 9. Testing

| Test file | Coverage |
|---|---|
| `app/pillar-analysis/[id]/components/MemoMarkdown.test.tsx` (new) | Renders sample memo containing each markdown element type; asserts expected classes / structure. Asserts raw HTML in input is escaped, not executed. |
| `app/pillar-analysis/[id]/components/MemoPoller.test.tsx` (new) | Mocks fetch and `document.visibilityState`. Asserts: polls every 3s while null; stops on memo arrival; pauses when hidden; resumes on visible. Asserts `router.refresh()` called exactly once on arrival. |
| `app/pillar-analysis/[id]/components/StrategicMemoCard.test.tsx` (new) | Null-state renders hint and mounts `MemoPoller`. Has-memo state renders `MemoMarkdown` and `RelativeTime`, does NOT mount `MemoPoller`. |
| `app/api/pillar-analysis/by-session/[sessionId]/route.test.ts` (extend existing if present, otherwise new) | Asserts response includes `aiNarrative` and `narrativeUpdatedAt` fields with correct types and null behavior. |

No pixel-snapshot tests. Visual matching to the dashboard is verified manually during implementation.

## 10. Acceptance criteria

- [ ] On a `/pillar-analysis/[id]` page where `aiNarrative` is null: the Strategic Memo card renders below the score grid, shows the hint text referencing "Copy Claude Prompt", and the header button label reads "Copy Claude Prompt".
- [ ] On a page where `aiNarrative` is non-null: the memo renders as styled markdown with all six section headers, the timestamp shows relative time with absolute on hover, and the header button label reads "Regenerate via Claude".
- [ ] When an analyst is on a null-state page and a PATCH to `aiNarrative` happens (simulated via a separate request or DB write), the page auto-refreshes within ~3 seconds and the memo appears.
- [ ] When an analyst switches away from the tab while the page is in null state, the polling pauses (verifiable via Network panel). Resumes on tab return.
- [ ] The sticky nav is visible at the top of the page, scrolls with the page, and clicking a link jumps to the matching section.
- [ ] `npx tsc --noEmit` passes. `npm test` passes. `npm run build` passes.
- [ ] No new dependency beyond `react-markdown`.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `react-markdown` defaults render safely, but a future contributor might add `rehype-raw` and accidentally enable HTML injection. | Add a comment in `MemoMarkdown.tsx` explaining the deliberate omission of `rehype-raw`. |
| Hydration mismatch on `RelativeTime` (server renders one timestamp, client renders another a moment later). | Render absolute on first paint, upgrade to relative in `useEffect`. Documented in component. |
| Polling during a long-tab-open session burns requests. | Visibility-pause covers most of this; 3s interval is gentle; poller stops permanently on first memo arrival. Realistic worst case: an analyst leaves the tab open and visible for an hour without running the skill — 1200 cheap GET requests. Acceptable. |
| Sticky nav covers content when jumping to anchors. | CSS `scroll-margin-top` on each section to offset for the sticky nav height. |
| `narrativeUpdatedAt` is null even when `aiNarrative` is set (legacy rows or partial PATCH). | `RelativeTime` accepts `Date \| null` and renders nothing if null. The memo still displays. |

## 12. Open questions deferred to Phase 3+

- Active-section highlighting in the sticky nav (would require `IntersectionObserver`).
- "What would you like to change?" textarea on regenerate.
- Real-time WebSocket updates instead of polling.
- Memo version history / diff view.
- Print-friendly stylesheet for the memo (analysts may want to PDF the page for client-facing redacted versions, though the memo voice is internal-only — would need redaction first).

## 13. Estimated effort

- 1 spec (this doc).
- 1 implementation plan (~6–8 tasks).
- Implementation: 4–6 hours of focused work, including tests.
- No deploy gates or env-var changes — ships with the existing pre-merge checklist for Phases 1, 2.1, 2.2.
