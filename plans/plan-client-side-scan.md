# Plan: Client-Side Scan Feasibility

## Short Answer

**Client-side execution cannot replace the server-side scanner.** The core use case — scanning arbitrary external URLs — is impossible from a browser due to CORS/Same-Origin Policy. The server's Puppeteer + headless Chrome is the only viable approach for that.

However, there are meaningful **server-side optimizations** that would speed up scans significantly.

---

## Why Client-Side Doesn't Work for External URLs

| Blocker | Why It Can't Move Client-Side |
|---------|-------------------------------|
| CORS | Browser blocks JS on `seotools.example.com` from accessing DOM of `client-site.com` |
| SSRF protection | DNS validation of private IP ranges must run server-side |
| Screenshots | Puppeteer `page.screenshot()` has no browser equivalent for external pages |
| Audit history / DB | Results need to land in Prisma; client would need to POST raw results back anyway |

**Even a browser extension** can't scan cross-origin pages — Same-Origin Policy applies to extensions too (they can scan the current tab's own page, not arbitrary URLs).

---

## Where Time Actually Goes (Current Flow)

Per agent analysis of `lib/ada-audit/runner.ts`:

| Phase | % of audit time | Notes |
|-------|-----------------|-------|
| Browser pool acquire | ~1-2s (amortized) | Pool reuse helps; browser stays alive |
| `page.goto()` + `networkidle2` | **30-45%** | Dominant bottleneck — waits for full network idle |
| axe-core execution | ~2-5s | Fast |
| Screenshot capture | ~1-3s (15 screenshots max) | Synchronous, runs after axe |
| DB write | <1s | Not a bottleneck |

---

## Recommended Server-Side Optimizations

### 1. Reduce networkidle2 timeout (biggest win, ~10-20s per audit)

**File:** `lib/ada-audit/runner.ts` — `page.goto()` call

Change from:
```typescript
waitUntil: 'networkidle2', timeout: 30000
```
To a smarter wait:
```typescript
// Option: lower the idle threshold
waitUntil: 'networkidle0', timeout: 15000
// Or: use domcontentloaded + explicit wait
waitUntil: 'domcontentloaded', timeout: 15000
// then: await page.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 }).catch(() => {})
```

**Risk:** Some SPAs or lazy-loading sites may not be fully rendered. Could add a flag on the audit form ("Fast scan" vs "Full scan").

### 2. Lazy screenshot capture (2-3s win)

Currently screenshots block audit completion. Return results immediately, then capture screenshots as a background task and update the record.

**Files:** `lib/ada-audit/runner.ts`, `lib/ada-audit/screenshot-helpers.ts`

```typescript
// Return results first, then fire-and-forget screenshot capture
await updateAuditRecord(id, { status: 'complete', results })
captureScreenshots(id, page, violations).catch(console.error)  // non-blocking
```

Client already polls — screenshots would appear on the next poll cycle.

### 3. Increase browser pool size (linear throughput gain for concurrent scans)

**File:** `lib/ada-audit/browser-pool.ts`

Current `POOL_SIZE` default is 2 (env `BROWSER_POOL_SIZE`). Each Chrome page ~150MB RAM. The VPS has ~3.8GB. Could safely go to 4:

```bash
# In production .env or start command:
BROWSER_POOL_SIZE=4
```

Doubles concurrent scan throughput for site audits.

### 4. Result caching for repeated scans (optional, 100% win for re-scans)

Add a TTL-based cache: if the same URL was scanned within the last N hours, return the cached result. Could be opt-in via a "Force fresh scan" checkbox.

**Effort:** Medium — needs new DB column or in-memory TTL map.

---

## Client-Side Complement (Optional Bookmarklet)

A bookmarklet could be a useful *addition* for users who want to quickly test their own site while browsing:

```javascript
javascript:(function(){
  var s=document.createElement('script');
  s.src='https://cdn.deque.com/axe/latest/axe.min.js';
  s.onload=function(){axe.run().then(function(r){console.table(r.violations)})};
  document.head.appendChild(s);
})();
```

This would scan the current tab instantly (2-5s) and log results to console. No screenshots, no history, same-origin only. **Not a replacement** — a developer utility.

---

## Recommendation

Don't build client-side infrastructure. Instead:

1. **Implement lazy screenshot capture** — low effort, immediate win
2. **Reduce networkidle2 timeout** — medium effort, biggest single speed gain
3. **Bump BROWSER_POOL_SIZE to 4** — trivial, doubles concurrent throughput
4. **Bookmarklet** — low effort optional add-on for developer use
