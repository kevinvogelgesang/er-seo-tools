# Plan: Remove Element Truncation in Dropdowns

## Current Behavior

**File:** `components/ada-audit/AuditIssueCard.tsx`

Line 34:
```typescript
const displayNodes = violation.nodes.slice(0, 5)
```

Lines 120-124:
```tsx
{violation.nodes.length > 5 && (
  <p className="text-xs text-gray-400 italic mt-1">
    + {violation.nodes.length - 5} more elements (truncated for display)
  </p>
)}
```

All elements beyond the first 5 are hidden. The user cannot see them without exiting and there's no way to expand.

**Note:** The DB itself stores a max of 20 nodes per violation (set in `lib/ada-audit/runner.ts`). So the max is already 20; we're just showing 5.

---

## Fix: Show All Nodes, Load-on-Demand Style

### Option A: Show all nodes immediately (simple, recommended)

Remove the slice and the truncation message:

```typescript
// Line 34 — remove the slice:
// Before:
const displayNodes = violation.nodes.slice(0, 5)
// After:
const displayNodes = violation.nodes
```

Delete lines 120-124 (the "+ X more elements" message).

**Trade-off:** Each expanded violation card could show up to 20 code blocks. This is fine — each block is a `<pre>` with a selector and snippet. No lazy loading needed.

### Option B: Show 5, with a "Show all" toggle (progressive disclosure)

Add a `showAll` state to the card and toggle it:

```typescript
const [showAll, setShowAll] = useState(false)
const displayNodes = showAll ? violation.nodes : violation.nodes.slice(0, 5)
```

Replace the truncation message with:
```tsx
{!showAll && violation.nodes.length > 5 && (
  <button
    onClick={() => setShowAll(true)}
    className="text-xs text-orange hover:text-orange-light mt-1 transition-colors"
  >
    Show {violation.nodes.length - 5} more elements
  </button>
)}
```

**Recommendation:** Option A unless cards are visually overwhelming in testing. 20 nodes is not a lot.

---

## Files to Change

| File | Change |
|------|--------|
| `components/ada-audit/AuditIssueCard.tsx` | Remove `.slice(0, 5)` on line 34; remove truncation message block |

## Effort

Tiny — 2-5 line change in one file.
