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
- Pixel-snapshot tests of the memo card.
- Active-section highlighting in the sticky nav (deferred — V1 is plain anchor links).

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
- Card header: "Strategic Memo" title on the left; on the right, "Updated 3 hours ago" rendered as relative time. The absolute timestamp is available on hover via the wrapper element's `title` attribute.
- Body: the markdown rendered via `react-markdown` with hand-rolled component overrides matching the dashboard's typography (font-display headers, navy palette, dark-mode variants).
- Always renders full — no max-height, no expand/collapse. The memo is the strategic read; collapsing it would hide the value.
- Note on staleness: the memo is "old" only relative to itself. The deterministic dashboard fields (score, hub, topics, verdicts) live on the same `PillarAnalysis` row and are immutable once written, so the memo is always internally consistent with the data displayed alongside it. See §13 for the data-model rationale.

**No memo** (`aiNarrative` is null):
- Card header: "Strategic Memo".
- Body: a single instructional hint — "Strategic memo not yet generated. Click **Copy Claude Prompt** above and paste it into Claude Desktop. The memo will appear here automatically."
- A `MemoPoller` client component is mounted to detect arrival (see §4.4).

### 4.3 Header button relabeling

`CopyClaudePromptButton` accepts a new `hasMemo: boolean` prop:
- `false` → label is "Copy Claude Prompt" (current behavior).
- `true` → label is "Regenerate via Claude".

Action is unchanged in both cases (mint token + copy payload). Only the label changes.

When clicked, the button additionally fires a callback that triggers a polling cycle (see §4.4) regardless of current memo state. This keeps the regenerate experience as seamless as the initial-generation experience: paste in Claude Desktop, wait, and the dashboard updates itself.

### 4.4 Auto-refresh — action-triggered, time-bounded polling

The poller's behavior is modeled on **trigger events**, not on the current memo state. This handles both "memo not yet generated" and "regenerate over an existing memo" with one mechanism, and bounds polling to active intent.

**Triggers that start a polling cycle:**
1. Page mount when `aiNarrative` is null (initial-generation case).
2. The "Copy Claude Prompt" / "Regenerate via Claude" button is clicked (regeneration case, OR a re-attempt at initial generation).

**Polling cycle behavior:**
1. Polls `GET /api/pillar-analysis/by-session/[sessionId]` every 3 seconds.
2. The cycle records the `narrativeUpdatedAt` value at start (or `null` if no memo). On each response, if `narrativeUpdatedAt` differs from the recorded baseline, the memo has been written or rewritten — the cycle stops and calls `router.refresh()`.
3. Pauses while `document.visibilityState === 'hidden'`. Resumes on `visible`. Time spent paused does NOT count against the cycle's lifetime cap.
4. **Hard lifetime cap of 15 minutes per cycle** (cumulative active-polling time). On expiry, the cycle stops without action.
5. A new button click while a cycle is active resets the cycle (new baseline timestamp, fresh 15-min budget).
6. After cycle expiry without a memo update, the card surfaces a small "Check for memo" link that, when clicked, starts a fresh cycle.

**Where the poller is mounted:**
- Mounted only on `/pillar-analysis/[id]`. Not on the audit page, not on any other route. There is no global polling.
- Always mounted on the pillar-analysis page (regardless of memo state) so the button click can trigger it. When idle (no active cycle), it does not make requests.

This bounds the worst case sharply: a user who opens a null-state pillar dashboard on a secondary monitor and never interacts will experience exactly one 15-minute polling burst (≤ 300 requests, gated by visibility), then silence. The dashboard does not poll forever just because it's open.

## 5. Architecture

### 5.1 New components

| File | Type | Responsibility |
|---|---|---|
| `app/pillar-analysis/[id]/components/StrategicMemoCard.tsx` | Server Component | Top-level card. Branches on `aiNarrative` presence. Renders `MemoMarkdown` + `RelativeTime` (has-memo) or hint text (null). Always mounts `MemoPoller` (poller is idle until triggered). |
| `app/pillar-analysis/[id]/components/MemoMarkdown.tsx` | Client Component | Wraps `react-markdown` with custom component overrides for `h2`, `h3`, `p`, `ul`, `ol`, `li`, `strong`, `em`. Default sanitization (no `rehype-raw`). |
| `app/pillar-analysis/[id]/components/MemoPoller.tsx` | Client Component | Action-triggered, time-bounded polling against the by-session endpoint. Watches `narrativeUpdatedAt` for change. Pauses on tab hidden. Calls `router.refresh()` on change. 15-min cumulative cap per cycle. See §4.4. Exposes a context or imperative handle so `CopyClaudePromptButton` can trigger a new cycle on click. |
| `app/pillar-analysis/[id]/components/RelativeTime.tsx` | Client Component | Renders nothing on the server (returns `null`). On client mount, renders `<span title={absoluteLocal}>{relative}</span>` with both values formatted in the user's local timezone. Re-computes relative every 60s. The first-paint-null pattern eliminates the timezone hydration mismatch entirely. |
| `app/pillar-analysis/[id]/components/SectionNav.tsx` | Client Component | Sticky nav bar with anchor links. Client because we may add active-section highlighting via `IntersectionObserver` later (deferred — V1 is plain anchor links). |

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
  → StrategicMemoCard branches body:
      has memo → MemoMarkdown + RelativeTime
      null     → instructional hint
  → MemoPoller is always mounted on the page (idle until triggered)

Client — polling cycle is action-triggered (§4.4):
  Trigger 1: page mount with aiNarrative === null
  Trigger 2: CopyClaudePromptButton onClick

  Cycle:
    record baseline = narrativeUpdatedAt (or null)
    every 3s while visible AND cumulative-active-time < 15min:
      GET /api/pillar-analysis/by-session/[sessionId]
      if response.narrativeUpdatedAt !== baseline:
        → router.refresh()    (server re-renders with the new memo)
        → cycle ends
    on lifetime expiry without change:
      → cycle ends, surfaces "Check for memo" affordance
      → clicking it starts a fresh cycle
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
| `app/pillar-analysis/[id]/components/MemoPoller.test.tsx` (new) | Mocks fetch, `document.visibilityState`, and timers. Asserts: cycle starts on initial null mount; cycle starts on imperative trigger (button click); polls every 3s while visible; pauses when hidden and resumes on visible; calls `router.refresh()` exactly once on `narrativeUpdatedAt` change; stops at the 15-min cumulative-active cap; surfaces a "Check for memo" affordance after expiry; "Check for memo" click starts a fresh cycle with a fresh budget. |
| `app/pillar-analysis/[id]/components/StrategicMemoCard.test.tsx` (new) | Null-state renders hint. Has-memo state renders `MemoMarkdown` and `RelativeTime`. `MemoPoller` is mounted in both states (idle until triggered). |
| `app/pillar-analysis/[id]/components/RelativeTime.test.tsx` (new) | Server-side render returns `null`. After client mount, renders relative + absolute-on-hover. Re-computes on the 60s tick. Renders nothing when `value` is `null`. |
| `app/api/pillar-analysis/by-session/[sessionId]/route.test.ts` (extend existing if present, otherwise new) | Asserts response includes `aiNarrative` and `narrativeUpdatedAt` fields with correct types and null behavior. |

No pixel-snapshot tests. Visual matching to the dashboard is verified manually during implementation.

## 10. Acceptance criteria

- [ ] On a `/pillar-analysis/[id]` page where `aiNarrative` is null: the Strategic Memo card renders below the score grid, shows the hint text referencing "Copy Claude Prompt", and the header button label reads "Copy Claude Prompt".
- [ ] On a page where `aiNarrative` is non-null: the memo renders as styled markdown with all six section headers, the timestamp shows relative time with absolute on hover, and the header button label reads "Regenerate via Claude".
- [ ] When an analyst is on a null-state page and a PATCH to `aiNarrative` happens (simulated via a separate request or DB write), the page auto-refreshes within ~3 seconds and the memo appears.
- [ ] When an analyst is on a has-memo page and clicks "Regenerate via Claude", a fresh polling cycle starts. When `narrativeUpdatedAt` then changes, the page auto-refreshes and the new memo replaces the old one.
- [ ] When an analyst switches away from the tab while the polling cycle is active, the polling pauses (verifiable via Network panel). Resumes on tab return. Time spent paused does not consume the cycle's budget.
- [ ] After 15 minutes of cumulative active polling without a memo update, the cycle stops and a "Check for memo" affordance appears in the card. Clicking it starts a fresh cycle.
- [ ] The sticky nav is visible at the top of the page, scrolls with the page, and clicking a link jumps to the matching section.
- [ ] No timezone hydration warnings in the React console for `RelativeTime`.
- [ ] `npx tsc --noEmit` passes. `npm test` passes. `npm run build` passes.
- [ ] No new dependency beyond `react-markdown`.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `react-markdown` defaults render safely, but a future contributor might add `rehype-raw` and accidentally enable HTML injection. | Add a comment in `MemoMarkdown.tsx` explaining the deliberate omission of `rehype-raw`. |
| Timezone hydration mismatch on `RelativeTime` (server renders absolute time in server TZ, client hydrates in user's local TZ). | `RelativeTime` returns `null` from its first render and only emits the timestamp after client mount via `useEffect`. The server never produces a localized timestamp string, so there is nothing to mismatch. |
| Runaway polling on a dashboard left open on a secondary monitor. | Polling is action-triggered, not state-triggered. Hard 15-min cumulative-active cap per cycle. Visibility-paused while tab is hidden. Worst case for an idle viewer: one 15-min burst (≤ 300 requests), then silence until the analyst clicks something. |
| Regeneration flow leaves the user staring at the old memo. | Button click triggers a fresh polling cycle even when a memo is already present. The cycle watches `narrativeUpdatedAt` for change, so a successful PATCH triggers `router.refresh()` automatically. |
| Sticky nav covers content when jumping to anchors. | CSS `scroll-margin-top` on each section to offset for the sticky nav height. |
| `narrativeUpdatedAt` is null even when `aiNarrative` is set (legacy rows or partial PATCH). | `RelativeTime` accepts `Date \| null` and renders nothing if null. The memo still displays. The polling cycle's baseline is set to whatever value comes back at start; subsequent change detection still works. |

## 12. Open questions deferred to Phase 3+

- Active-section highlighting in the sticky nav (would require `IntersectionObserver`).
- "What would you like to change?" textarea on regenerate.
- Real-time WebSocket updates instead of polling.
- Memo version history / diff view.
- Print-friendly stylesheet for the memo (analysts may want to PDF the page for client-facing redacted versions, though the memo voice is internal-only — would need redaction first).

## 13. Data-model rationale (memo staleness)

A reasonable instinct on first reading: "the memo could become stale relative to other dashboard data, and we should compare `narrativeUpdatedAt` to the latest update of the underlying pillar data to surface that." We deliberately do NOT do this, because the data model makes it unnecessary.

The `PillarAnalysis` row is **immutable for everything except the narrative fields**. Score, hub recommendation, pillar topics, URL verdicts, subscores, and the input-derived fields are all written once in the analysis pipeline and never updated. There is no "the score data changed an hour ago" for an existing row — it can't.

The two narrative fields (`aiNarrative`, `narrativeUpdatedAt`) are the only mutable surface on the row, and they're written together by the same PATCH. So:

- **Same row:** memo and deterministic data are guaranteed to describe the same inputs. The memo cannot be stale relative to its row's data.
- **Different row:** if the analyst re-imports SF data, that produces a new `Session` and a new `PillarAnalysis` row. The new row starts with `aiNarrative === null` and the analyst will be invited to generate a fresh memo. The old row's memo stays attached to its old, internally-consistent data.

This means the only meaningful staleness signal is the memo's own age relative to "now" — which is what `narrativeUpdatedAt` directly captures. A future contributor reading the dashboard code may reasonably wonder why we don't compare timestamps; this section is the answer.

## 14. Estimated effort

- 1 spec (this doc).
- 1 implementation plan (~6–8 tasks).
- Implementation: 4–6 hours of focused work, including tests.
- No deploy gates or env-var changes — ships with the existing pre-merge checklist for Phases 1, 2.1, 2.2.
