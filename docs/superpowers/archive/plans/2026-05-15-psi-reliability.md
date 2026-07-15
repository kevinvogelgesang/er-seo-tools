# PSI Reliability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eliminate the two PSI-failure modes observed in the 2026-05-15 fei.edu retry (PR #16 verification run): four pages timed out at the 90s ceiling, two pages hit HTTP 500. Both classes were preventable with operational tuning.

**Architecture:** Two changes, no API surface or behavior change for callers:

1. Bump `PAGESPEED_TIMEOUT_MS` from `90000` to `150000` in `ecosystem.config.js`. Content-heavy pages legitimately take >90s for PSI's lab simulation; the existing budget was too tight.
2. Retry once on HTTP 5xx inside `runPageSpeedInsights`. PSI 5xx is typically a transient backend flake that resolves on a fresh load-balanced backend. No backoff delay — if the issue is global, retrying fast is no worse than retrying slow. **Only retries 5xx; never retries 4xx (deterministic) or AbortError/timeout (don't want to double the wall-clock cost on consistently slow pages).**

**Tech stack:** TypeScript · vitest. No new dependencies.

**Expected payoff:** Would have caught 6/6 errors on the previous fei.edu run. Per-page LH coverage rises from ~82% to ≥94% on similar sites.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `ecosystem.config.js` | Modify | `PAGESPEED_TIMEOUT_MS` `90000` → `150000` |
| `lib/ada-audit/lighthouse-pagespeed.ts` | Modify | Extract `fetchPsiWithTimeout` helper; retry once on response.status >= 500 |
| `lib/ada-audit/lighthouse-pagespeed.test.ts` | Modify | +4 tests for the retry behavior; existing 13 tests unchanged |
| `docs/superpowers/plans/2026-05-15-psi-reliability.md` | Create | This plan |

---

### Task 1: Branch + commit plan

**Files:** none beyond the plan doc.

- [ ] **Step 1: Pull latest main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 2: Create the feature branch**

If executing via subagent-driven-development, use `EnterWorktree` with name `feat-psi-reliability`. The plan doc is in this directory.

- [ ] **Step 3: Commit the plan**

```bash
git add docs/superpowers/plans/2026-05-15-psi-reliability.md
git commit -m "docs: plan for PSI reliability fixes (timeout 150s + retry-once 5xx)"
```

---

### Task 2: Bump `PAGESPEED_TIMEOUT_MS` in `ecosystem.config.js`

**Files:**
- Modify: `ecosystem.config.js`

- [ ] **Step 1: Apply the change**

Find the env block. Change:

```javascript
      PAGESPEED_TIMEOUT_MS: '90000',
```

to:

```javascript
      PAGESPEED_TIMEOUT_MS: '150000',
```

- [ ] **Step 2: Verify config still parses**

```bash
node -e "console.log(JSON.stringify(require('./ecosystem.config.js'), null, 2))" | grep -E 'PAGESPEED_TIMEOUT_MS'
```

Expected: prints `"PAGESPEED_TIMEOUT_MS": "150000"`.

- [ ] **Step 3: Commit**

```bash
git add ecosystem.config.js
git commit -m "fix(ada-audit): raise PAGESPEED_TIMEOUT_MS to 150s for content-heavy pages"
```

---

### Task 3: TDD retry-once on 5xx

**Files:**
- Modify: `lib/ada-audit/lighthouse-pagespeed.ts`
- Modify: `lib/ada-audit/lighthouse-pagespeed.test.ts`

#### Step 1: Write the failing tests

Append to `lib/ada-audit/lighthouse-pagespeed.test.ts` inside the existing `describe('runPageSpeedInsights', …)` block (after the last existing test). Note the new tests use `mockResolvedValueOnce` chains to sequence multiple responses:

```typescript
  it('retries once on HTTP 5xx; if the retry succeeds, returns the summary', async () => {
    // First call: 503. Second call: 200 + valid LHR.
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce({
        ok: false, status: 503,
        json: async () => ({ error: 'transient' }),
        text: async () => 'transient',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ lighthouseResult: MINIMAL_LHR }),
        text: async () => JSON.stringify({ lighthouseResult: MINIMAL_LHR }),
      } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.error).toBeUndefined()
    expect(result.summary?.scores.performance).toBe(50)
  })

  it('retries once on HTTP 5xx; if the retry also 5xx, surfaces the error', async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}), text: async () => '' } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}), text: async () => '' } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/server error|HTTP 5/i)
  })

  it('does NOT retry on HTTP 4xx', async () => {
    const fetchMock = mockFetch({ ok: false, status: 400, body: {} })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/private')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/private|blocked|unfetch|HTTP 400/i)
  })

  it('does NOT retry on AbortError (timeout)', async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPageSpeedInsights('https://example.com/')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.summary).toBeNull()
    expect(result.error).toMatch(/timed out/i)
  })
```

#### Step 2: Run, verify it fails

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/lighthouse-pagespeed.test.ts
```

Expected: the 4 new tests fail. The "retries once on 5xx; if the retry succeeds" test fails because the current impl makes only 1 fetch call and returns the 5xx error. The "retries on 5xx; if retry also 5xx" test fails for the same reason (only 1 call). The two "does NOT retry" tests still pass under current code (since current code never retries), but assert the count explicitly so they'd catch a regression in either direction.

#### Step 3: Implement the retry

In `lib/ada-audit/lighthouse-pagespeed.ts`, extract the fetch+timeout pattern into a helper, then add the 5xx-retry inside `runPageSpeedInsights`.

Replace the existing `runPageSpeedInsights` body with:

```typescript
async function fetchPsiWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function runPageSpeedInsights(targetUrl: string): Promise<RunLighthouseResult> {
  const timeoutMs = parsePositiveInt(process.env.PAGESPEED_TIMEOUT_MS, 90_000)
  const psiUrl = buildPsiUrl(targetUrl)
  try {
    let response = await fetchPsiWithTimeout(psiUrl, timeoutMs)
    if (!response.ok && response.status >= 500) {
      // Retry once on PSI 5xx — Google-side flake typically resolves on a fresh
      // backend. No backoff; if the issue is global, retrying fast is no worse
      // than retrying slow. We do NOT retry on 4xx (deterministic) or AbortError
      // (don't want to double the wall-clock cost on consistently slow pages).
      response = await fetchPsiWithTimeout(psiUrl, timeoutMs)
    }
    if (!response.ok) {
      return { summary: null, error: mapHttpError(response.status) }
    }
    let json: unknown
    try {
      json = await response.json()
    } catch {
      return { summary: null, error: 'PSI returned malformed response.' }
    }
    const lhr = (json as { lighthouseResult?: unknown }).lighthouseResult
    if (!lhr) {
      return { summary: null, error: 'PSI returned no lighthouseResult.' }
    }
    return { summary: extractSummary(lhr) }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { summary: null, error: `PSI timed out after ${timeoutMs}ms.` }
    }
    return { summary: null, error: err instanceof Error ? err.message : String(err) }
  }
}
```

Changes from the existing impl:
- The fetch + AbortController + setTimeout pattern is now in `fetchPsiWithTimeout`. Each attempt gets a fresh controller + timer; clearTimeout in `finally`.
- The outer try wraps both attempts. AbortError from either attempt propagates to the catch and is mapped to the timeout message.
- The retry only fires when `!response.ok && response.status >= 500`. 4xx returns immediately via the `!response.ok` branch below.

#### Step 4: Run, verify all 17 tests pass (13 existing + 4 new)

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/lighthouse-pagespeed.test.ts
```

Expected: 17/17 passing.

#### Step 5: Commit

```bash
git add lib/ada-audit/lighthouse-pagespeed.ts lib/ada-audit/lighthouse-pagespeed.test.ts
git commit -m "fix(ada-audit): retry-once on PSI HTTP 5xx"
```

---

### Task 4: Verify lint + full test suite + build

**Files:** none.

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean (`tsc --noEmit` exits 0, no output).

- [ ] **Step 2: Full test suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run
```

Expected: PASS. Baseline 1142, **+4 new tests, new total 1146**.

- [ ] **Step 3: Production build**

```bash
rm -rf .next && npm run build
```

Expected: clean.

---

### Task 5: Push branch + open PR

- [ ] **Step 1: Push**

```bash
git push -u origin fix/psi-reliability
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "fix(ada-audit): PSI reliability — 150s timeout + retry-once on 5xx" --body "$(cat <<'EOF'
## Summary
Eliminates the two PSI-failure modes observed in the 2026-05-15 fei.edu retry: four pages timed out at 90s, two pages hit HTTP 500.

## Changes

### 1. `PAGESPEED_TIMEOUT_MS` 90000 → 150000 (in `ecosystem.config.js`)
PSI's lab simulation on content-heavy pages legitimately exceeds 90s. The 150s ceiling absorbs Google's slower runs without imposing per-page latency on the audit (PSI is HTTP — our CPU sits idle during the wait).

### 2. Retry-once on PSI HTTP 5xx (in `runPageSpeedInsights`)
PSI 5xx is typically a transient backend flake that resolves on a fresh load-balanced backend. The retry has no backoff — if the issue is global, retrying fast is no worse than retrying slow.

**Only retries 5xx.** Does NOT retry:
- 4xx (deterministic: bad URL, bad key, blocked, quota)
- AbortError/timeout (would double the wall-clock cost on consistently slow pages)

## Reliability impact on the previous fei.edu run
Would have caught 6/6 PSI errors observed:
- 4 timeouts at 90000ms → now have 150000ms headroom
- 2 HTTP 500s → would have retried; very high probability of success on second attempt

Expected per-page LH coverage on similar sites: ~82% → ≥94%.

## Tests
- **+4 new tests** in `lib/ada-audit/lighthouse-pagespeed.test.ts`:
  - 5xx then 200 → retried, summary returned
  - 5xx then 5xx → retried, error surfaced
  - 4xx → not retried (`fetchMock.mock.calls.length === 1`)
  - AbortError → not retried
- Existing 13 PSI tests unchanged and still passing
- Total: **1146 tests pass** (was 1142)

## Deploy mechanics
The `PAGESPEED_TIMEOUT_MS` change is in `ecosystem.config.js` (checked into git). After deploy:
```bash
ssh $PROD_SSH 'pm2 delete seo-tools && pm2 start $APP_HOME/ecosystem.config.js'
```
`pm2 delete + start` is required to re-read the config file (plain `pm2 restart` won't).

## Rollback
Revert the PR. Or for an emergency env-only rollback:
```bash
ssh $PROD_SSH "cd $APP_HOME && sed -i \"s/PAGESPEED_TIMEOUT_MS: '150000'/PAGESPEED_TIMEOUT_MS: '90000'/\" ecosystem.config.js && pm2 delete seo-tools && pm2 start ecosystem.config.js"
```
(The retry behavior is code, so an env-only rollback can't disable it. Code revert via PR if needed.)

## Out of scope
- `SITE_AUDIT_CONCURRENCY` bump to 2 — that's PR-B, opens after this lands and is verified on a deployed run.
- More aggressive retry policies (exponential backoff, retry on 4xx, multi-retry) — premature; first retry catches the bulk of transient failures.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL.**

---

## Self-review checklist

- [x] **Spec coverage**: 2 changes (config + code), both with tests for the code change.
- [x] **No placeholders**: all values concrete, all commands runnable.
- [x] **Test ordering**: RED-then-GREEN for the retry. Existing tests stay green (their assertions are tolerant of retry — they don't assert call counts for the 5xx path, only for the 4xx and AbortError negative paths).
- [x] **Type consistency**: `fetchPsiWithTimeout(url: string, timeoutMs: number): Promise<Response>`. Internal helper, no export.
- [x] **AbortController lifecycle**: each `fetchPsiWithTimeout` call has its own controller + timer + finally. No leak between the two attempts.
- [x] **Deploy reminder**: `pm2 delete + start` is required for the env var; called out in the PR body.
- [x] **PR-B sequencing**: explicitly out-of-scope here; opens after this lands.
