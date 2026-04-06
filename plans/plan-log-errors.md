# Plan: Server Log Error Analysis

## Current Log State

The production log at `/home/seotools/er-seo-tools.log` contains only one error:

```
[ada-audit] id=cmnf3s3si0001u3z3jnlytqlu url=http://www.beal.edu/ error: Error: HTTP 403 —
    at l (.next/server/app/api/ada-audit/route.js:1:1597)
    at async m (.next/server/app/api/ada-audit/route.js:1:11750)
```

## Analysis

**This is not a bug in our code.** `beal.edu` returned HTTP 403 Forbidden, which means the site is blocking our scanner (likely detecting the headless Chrome user-agent or blocking the server's IP).

The error is caught properly and stored against the audit record — the scanner did the right thing.

## No Code Fixes Needed

The log is clean. The 403 handling was already in place in `lib/ada-audit/runner.ts`:
```typescript
if (!response.ok()) throw new Error(`HTTP ${response.status()} — ${response.statusText()}`)
```

## Potential UX Improvement (Optional)

When a 403 is returned, the audit UI shows a generic error. We could improve the user-facing error message for common cases:

**File:** `lib/ada-audit/runner.ts` (after the `response.ok()` check)

```typescript
if (!response.ok()) {
  const status = response.status()
  if (status === 403) {
    throw new Error(`HTTP 403 — This site is blocking automated scanners. Try adding your server IP to the site's allowlist, or contact the site owner.`)
  }
  if (status === 401) {
    throw new Error(`HTTP 401 — This page requires authentication. The scanner cannot access password-protected pages.`)
  }
  throw new Error(`HTTP ${status} — ${response.statusText()}`)
}
```

## Summary

| Item | Status |
|------|--------|
| HTTP 403 on beal.edu | Expected — site is blocking the scanner, not our bug |
| Any other errors | None found |
| Log is otherwise clean | Yes |

**No blocking issues.** The optional UX improvement above is low-effort if desired.
