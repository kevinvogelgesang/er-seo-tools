# Plan: Fix Caching & HTTP 304 Handling

## Problem

### 1. HTTP Cache Not Disabled
`lib/ada-audit/browser-pool.ts:7-18` launches Chrome without `--disable-http-cache`. The singleton browser instance persists across audits and its disk cache is never cleared. If the same URL is scanned twice in quick succession, the second scan may serve cached assets, potentially missing freshly deployed changes.

### 2. HTTP 304 Not Handled
`lib/ada-audit/runner.ts:78-79`:
```typescript
if (!response) throw new Error('No response received from page')
if (!response.ok()) throw new Error(`HTTP ${response.status()} — ${response.statusText()}`)
```
`response.ok()` returns `true` for all 2xx AND 3xx codes, including 304. A 304 has no body — the browser loads from cache. This silently succeeds but means axe scans whatever was cached, not a fresh page load.

---

## Fix 1: Disable HTTP Cache in Browser Launch Args

**File:** `lib/ada-audit/browser-pool.ts`

Add `--disable-http-cache` to the `LAUNCH_ARGS` array:

```typescript
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-translate',
  '--disable-sync',
  '--disable-http-cache',   // <-- ADD THIS
  // ... rest of existing args
]
```

**Effect:** Every page navigation fetches fresh content from the origin server, bypassing both memory and disk cache. This also resolves the 304 issue since no cache means the server always returns 200.

---

## Fix 2: Explicit 304 Guard in Runner

**File:** `lib/ada-audit/runner.ts` (around line 78)

Even with `--disable-http-cache`, add an explicit check as a safety net:

```typescript
const response = await page.goto(targetUrl, {
  waitUntil: 'networkidle2',
  timeout: 30000,
})

if (!response) throw new Error('No response received from page')

const status = response.status()
if (status === 304) {
  throw new Error('HTTP 304 Not Modified — cached response received; re-run to get a fresh scan')
}
if (!response.ok()) {
  throw new Error(`HTTP ${status} — ${response.statusText()}`)
}
```

---

## Files to Change

| File | Change |
|------|--------|
| `lib/ada-audit/browser-pool.ts` | Add `'--disable-http-cache'` to `LAUNCH_ARGS` |
| `lib/ada-audit/runner.ts` | Add 304 status check after `page.goto()` |

## Effort

Small — two targeted one-line / three-line changes. No schema changes, no new files.
