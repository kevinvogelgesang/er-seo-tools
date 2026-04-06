# Plan: Hover States in ADA Audit

## Finding (Not a Bug)

The ADA scanner **cannot see hover states** — this is a fundamental limitation of how axe-core works, not a bug in our implementation.

**Why:** `lib/ada-audit/runner.ts:74` navigates with `waitUntil: 'networkidle2'`, which ensures CSS/fonts/scripts load. But axe-core then scans the **static DOM** — it never simulates mouse events. No `page.hover()`, `page.focus()`, or pseudo-state overrides are used.

**Practical impact:** If a link passes color-contrast *only* on `:hover` (e.g., underline appears on hover), axe-core evaluates the non-hover state and may flag it as non-compliant. This is correct behavior — WCAG requires links to be distinguishable from body text at all times, not just on interaction.

**WCAG guidance:** A link with a 3:1 contrast ratio AND an underline *only on hover* still fails WCAG 1.4.1 (Use of Color) because a user who hasn't hovered yet cannot distinguish the link. The fix is a persistent underline or sufficient contrast difference (not hover-only).

## What Needs to Change

### Option A: Update the Known Limitations notice (recommended, low effort)

**File:** `components/ada-audit/KnownLimitationsNotice.tsx`

Add a bullet explaining hover states specifically:

```tsx
// Add to the limitations list:
<li>
  Hover, focus, and other interactive states are not evaluated — CSS applied 
  only via <code>:hover</code> or <code>:focus</code> pseudo-classes (e.g., 
  underlines that appear on hover) are not visible to the scanner. WCAG requires 
  links to be distinguishable without relying on interaction.
</li>
```

### Option B: Inject pseudo-state CSS before scanning (advanced, medium effort)

Before running axe-core, inject a `<style>` block that forces `:hover`/`:focus` styles to apply universally:

```typescript
// In lib/ada-audit/runner.ts, after navigation but before axe injection:
await page.addStyleTag({
  content: `
    a:not(:hover) { text-decoration: underline !important; }
  `
})
```

**Caution:** This would make every link appear underlined regardless of its real hover state, which could suppress valid color-contrast failures. Not recommended unless specifically requested.

## Recommendation

**Do Option A only.** The scanner is working correctly. The real action is for the site being audited to fix its links so they're distinguishable without hover interaction.
