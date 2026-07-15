# Explainer Disclosure Component — Design

**Date:** 2026-07-14
**Status:** Approved by Kevin (chat), pending Codex review
**PR:** 1 of 3 (sales-audit overhaul series — lands FIRST; the sales report redesign PR consumes this component)

## Problem

Explanatory copy ("what does this measure", "how is this score computed", "what is this card") is scattered across the app in inconsistent forms: bespoke expanders (`ScoreExplanation`, `AdaScoreExplanation`), always-visible intro paragraphs that crowd sections (the C6 site-audit SEO sections), and cards with no explanation at all (client dashboard GSC/robots/keyword cards). Kevin wants one consistent disclosure pattern (reference: the "Social Style" popover mock — summary paragraph, tag chips, two-column Do/Don't lists, flagged footer note) that cleans up the UI while retaining the knowledge.

## Goals

- One reusable, structured explanation-disclosure primitive usable anywhere in the app (including public share/sales pages — it must need no fetches).
- Replace existing bespoke attempts at the same job; move always-visible intro copy into collapsed explainers.
- Keep all existing information — nothing is deleted, only relocated into the disclosure.

## Non-goals

- No floating popover/portal positioning. The component expands **inline** below its trigger (the app's contexts are section headers and card headers, not hover targets). The mock's visual language (tags, do/don't columns, flag note) is kept; its overlay behavior is not.
- No CMS/registry for copy. Copy stays colocated with each surface (the `lib/sales/copy.ts` precedent).
- The sales report view does NOT adopt it in this PR (that's PR 2's job).

## Design

### Component: `components/ui/Explainer.tsx` (client component)

```tsx
<Explainer label="How this score is calculated">
  <ExplainerSummary>One-paragraph plain-English summary.</ExplainerSummary>
  <ExplainerTags tags={['Density-based', 'Severity-weighted']} />
  <ExplainerColumns
    good={{ label: 'Helps the score', items: ['…'] }}
    bad={{ label: 'Hurts the score', items: ['…'] }}
  />
  {/* arbitrary children allowed — e.g. the existing score-factor tables */}
  <ExplainerNote>Flagged footer callout (the mock's "At the close" row).</ExplainerNote>
</Explainer>
```

- **Trigger:** a button row — label text + rotating chevron. `aria-expanded`, `aria-controls`; keyboard-operable by default (it's a `<button>`). Optional `defaultOpen` prop.
- **Panel animation:** CSS `grid-template-rows: 0fr → 1fr` wrapper (animates unknown heights without JS measurement), ~200ms ease. Wrapped in `motion-safe:` variants so `prefers-reduced-motion` users get an instant toggle.
- **Subcomponents** (same file, tiny, presentational): `ExplainerSummary` (muted paragraph), `ExplainerTags` (chip row), `ExplainerColumns` (responsive two-column list pair with ✓ green / ✗ red bullet markers; labels configurable — "Do/Don't", "Helps/Hurts", etc.), `ExplainerNote` (bordered footer callout with a flag icon).
- **Styling:** house Tailwind vocabulary (`dark:bg-navy-card`, `dark:border-navy-border`, `font-heading`/`font-body`, 12–13px scale). Two visual densities via a `variant` prop: `'card'` (bordered rounded panel — for standalone placement) and `'plain'` (borderless — for embedding inside an existing card).
- **No state beyond `useState(open)`**, no fetches, no context — safe on public token-gated pages and inside server-component trees.

### Adoptions (this PR)

1. **Score explanations** — `components/scoring/ScoreExplanation.tsx` and `AdaScoreExplanation.tsx`: keep their factor-breakdown content verbatim; replace their bespoke expander chrome with `Explainer` (label: "How this score is calculated"). Their existing tests updated to the new trigger semantics.
2. **Site-audit SEO sections** — `BrokenLinksSection`, `OnPageSeoSection`, `ContentSimilaritySection`, `ContentSignalsSection`, `TopicOverlapSection`, `DiscoveryCoverageSection`, `ContentAuditCard`: each section's always-visible intro/explainer paragraph(s) move into `<Explainer label="What does this measure?">` directly under the section heading. Findings/data rendering unchanged. (These sections render on the share view too via the C18 shell — the client component works there; zero fetches.)
3. **Client dashboard cards** — `GscKeywordCard`, `GscCannibalizationCard`, `RobotsCheckCard`, `KeywordProfileCard`, `KeywordStrategyCard`: add a header-level `<Explainer label="What is this?">` with new copy (2–4 sentences each: what the card measures, where the data comes from, honesty caveats — e.g. GSC "absence = not observed in window, never not-ranking"; robots "manual checks never alert"). Copy constants live beside each card (or in the card file when short).
4. **Opportunistic sweep** — during implementation, other surfaces with crowding intro copy (e.g. robots-validator page intro, reports page) may adopt it where it's a clear win. Bounded: the plan lists candidates; anything ambiguous is skipped, not forced.

### Error handling

None meaningful — pure presentational component. The only rule: adopting surfaces must not change what data they load or when.

### Testing

- `components/ui/Explainer.test.tsx`: renders collapsed by default, expands on click, `aria-expanded` toggles, `defaultOpen` works, subcomponents render their structure (tags, two columns with markers, note).
- Adoption updates: existing `ScoreExplanation.test.tsx` / `AdaScoreExplanation.test.tsx` suites updated for the new trigger; one section test updated (e.g. `OnPageSeoSection`) to prove intro copy now sits behind the disclosure; snapshot-free (query by role/text).
- Gates: `tsc --noEmit` + vitest.

## Sequencing note

This PR must merge before the sales-report redesign PR (which uses `Explainer` for score-methodology explanations). The prospect-dashboard PR is independent of both.
