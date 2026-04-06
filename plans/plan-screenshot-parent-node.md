# Plan: Screenshot Parent Node Instead of Element

## Current Behavior

**File:** `lib/ada-audit/screenshot-helpers.ts`

The current logic (lines 38-50):
1. Takes the most-specific CSS selector from axe's target path (e.g., `.error-message`)
2. Finds the element with `page.$(selector)`
3. Screenshots **that exact element** — tightly cropped with no surrounding context

**Problem:** A screenshot of a single `<a>` tag or `<span>` gives almost no visual context. You can't tell where on the page it is, what surrounds it, or why it might be failing.

---

## Fix: Capture Parent Element

**File:** `lib/ada-audit/screenshot-helpers.ts` — the element-capture block (around lines 38-55)

Replace the current screenshot call with a version that walks up to the parent element:

```typescript
// Current:
const handle = await page.$(selector)
if (!handle) { /* skip */ continue }
await handle.screenshot({ path: path.join(dir, filename), type: 'png' })

// New:
const handle = await page.$(selector)
if (!handle) { /* skip */ continue }

// Walk up to parent for context; fall back to element itself if no parent
const screenshotTarget = await page.evaluateHandle(
  (el) => el.parentElement ?? el,
  handle
)

await (screenshotTarget as ElementHandle).screenshot({
  path: path.join(dir, filename),
  type: 'png',
})

await handle.dispose()
await screenshotTarget.dispose()
```

### Want even more context (grandparent)?

```typescript
const screenshotTarget = await page.evaluateHandle(
  (el) => el.parentElement?.parentElement ?? el.parentElement ?? el,
  handle
)
```

---

## Files to Change

| File | Change |
|------|--------|
| `lib/ada-audit/screenshot-helpers.ts` | Replace `handle.screenshot(...)` with parentElement lookup + screenshot |

## Import Note

`ElementHandle` type needs to be imported from `puppeteer-core` at the top of the file if not already present:

```typescript
import type { ElementHandle } from 'puppeteer-core'
```

## Effort

Small — ~10 line change in one function, no schema changes.
