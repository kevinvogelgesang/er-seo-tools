# Viewbook viewer-collapse — PR5: inspector focus-pin bugfix + operator button removal

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Read the program overview + spec first. Global Constraints apply. Independent of PR2/PR3/PR4 (only lightly touches PR1's SectionQuickControls edits — rebase-order note below).

**Goal:** Fix the wedge where changing a section's state in the inline edit controls strands the inspector on that section until reload, and remove the now-redundant operator Collapse/Expand buttons (the hero chevron serves everyone as of PR3).

**Architecture:** The wedge is `SectionQuickControls` reporting `focused` to the per-section activity registry; a mutation button that unmounts while focused leaves `focus.focused` stuck true → a permanent hard "activity" pin → `SelectionContext.select()` fails closed for every other section. Fix: report busy-only to that registry (matching the sync-registry treatment already documented in the same file).

**Tech Stack:** React client components, Vitest + Testing Library.

**Rebase note:** PR1 already removes the `state === 'collapsed'`/Collapse/Expand branches from `SectionQuickControls` if it lands first. If PR5 lands before PR1's Task 3 touches this file, remove those branches here instead; either way the end state has no Collapse/Expand buttons and no `collapsed` branch.

---

### Task 1: Report busy-only to the per-section activity registry

**Files:**
- Modify: `components/viewbook/public/OperatorLayer/SectionQuickControls.tsx`
- Test: `components/viewbook/public/OperatorLayer/SectionQuickControls.test.tsx`

**Interfaces:**
- Consumes: `useReportSectionActivity` (`inspector/useSectionActivity`), `SelectionContext`.
- Produces: `SectionQuickControls` reports `{ dirty:false, busy, conflict:false, focused:false }` to the per-section activity registry (drops `focus.focused`).

- [ ] **Step 1: Failing regression test (the three assertions from spec §9).** Render two sections' controls inside the real `SelectionProvider` + `SectionActivityProvider`, drive a mutation on section A whose button unmounts on settle (Reset-ack is the cleanest trigger), and assert:

```ts
it('a discrete mutation pins A while busy, releases after settle even when the button unmounts, then B is selectable', async () => {
  // 1. render A + B controls inside providers; capture a handle to SelectionContext.select
  // 2. click A's mutation (Reset-ack / Hide) → while the fetch is in-flight, aggregateFor(A).busy === true (pinned)
  // 3. resolve the fetch; A's focused button unmounts (label swap / control disappears)
  // 4. await settle → anyActive(A) === false (pin released)
  // 5. select('B') returns true (NOT fails-closed)
})
```

Run: `npx vitest run components/viewbook/public/OperatorLayer/SectionQuickControls.test.tsx` → FAIL (currently B selection is blocked because A stays focus-pinned).

- [ ] **Step 2: Fix.** In `SectionQuickControls.tsx`, change the `useReportSectionActivity` snapshot to busy-only:

```ts
  useReportSectionActivity(section.sectionKey, `operator-section-controls-${section.sectionKey}`, {
    dirty: false,
    busy,
    conflict: false,
    focused: false, // was `focus.focused` — a mutation button that unmounts while focused
                    // strands focus.focused=true → permanent hard pin → inspector wedge (spec §9).
  })
```

Keep `useEditorActivity(..., busy)` (the sync registry) unchanged — it is already busy-only. The `useFocusWithin()` (`focus`) is still used for the container `onFocus`/`onBlur` handlers and can stay wired there; only its use in the ACTIVITY snapshot is removed. If `focus` becomes entirely unused after this, remove it and its handlers to keep tsc/lint clean.

- [ ] **Step 3: Run + gate + commit.**

Run: `npx vitest run components/viewbook/public/OperatorLayer` → PASS; tsc → 0.

```bash
git add components/viewbook/public/OperatorLayer/SectionQuickControls.tsx components/viewbook/public/OperatorLayer/SectionQuickControls.test.tsx
git commit -m "fix(viewbook): inspector no longer wedges after a section state change (busy-only pin)"
```

---

### Task 2: Remove the operator Collapse/Expand buttons

**Files:**
- Modify: `components/viewbook/public/OperatorLayer/SectionQuickControls.tsx`
- Test: `components/viewbook/public/OperatorLayer/SectionQuickControls.test.tsx`

**Interfaces:**
- Produces: `SectionQuickControls` no longer renders a Collapse or Expand button, and no `state === 'collapsed'` branch remains. Collapse for operators is the hero chevron (PR3).

- [ ] **Step 1: Failing test.**

```ts
it('renders no Collapse/Expand control (collapse is the hero chevron now)', () => {
  render(/* controls for a collapsible section */)
  expect(screen.queryByRole('button', { name: /collapse|expand/i })).toBeNull()
})
```

Run: FAIL (buttons still present unless PR1 already removed them — if so, this test passes immediately and just guards the state).

- [ ] **Step 2: Fix.** Delete the two JSX blocks: the `state === 'collapsed'` Expand button and the `collapsible && …` Collapse button. Remove the now-unused `sectionSupportsCollapse` import + the `collapsible` local. The `statePill` no longer needs a `'collapsed'` case (PR1 already reduced `state` to `hidden|active|done` — if not yet, drop the `'collapsed'` pill case here).

- [ ] **Step 3: Run + gate + commit.**

Run: `npx vitest run components/viewbook/public/OperatorLayer` → PASS; tsc → 0; `npm run build` → OK.

```bash
git add components/viewbook/public/OperatorLayer/SectionQuickControls.tsx components/viewbook/public/OperatorLayer/SectionQuickControls.test.tsx
git commit -m "refactor(viewbook): remove operator Collapse/Expand buttons (hero chevron replaces them)"
```

---

## PR5 self-check
- Root-cause fix (busy-only), not masking; regression asserts pinned-while-busy, release-on-unmount, then other-section-selectable.
- No Collapse/Expand button, no `'collapsed'` branch left in `SectionQuickControls`.
- Gates green incl. build.
