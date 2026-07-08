# SEO-Scan Intent Toggles + Labeling (C11 PR 2a) Implementation Plan

Status: **reviewed** (Codex plan review "ACCEPT-WITH-NAMED-FIXES" — all 10 fixes applied 2026-07-08).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scan *intent* (Accessibility vs SEO) a first-class, visible choice on every scan-trigger surface and queue view, wire SEO schedules to render-only `seoOnly` runs, and fix the `SeoScanForm` infinite-"running" bug — all with no schema migration.

**Architecture:** A pure `scanIntentOf` helper + one `<IntentChip>` become the single source of truth for the ADA/SEO label. The two ad-hoc forms (`SiteAuditForm`, `QuickSiteAuditWidget`) gain an intent toggle that threads `seoOnly` into the existing `/api/site-audit` body and routes SEO submits to `/seo-parser?scan=<id>` (the ADA results page redirects `seoOnly` audits away, dropping the id). `SeoScanForm` adopts `?scan=` (winning over stale sessionStorage) and treats `error`/`cancelled`/404 as terminal. The schedule path (`ScheduledScansCard` → POST route → `scheduled-site-audit.ts` → `getClientSchedules`) learns `seoOnly`, coercing `seoOnly ⇒ seoIntent` before its uniqueness check.

**Tech Stack:** Next.js 15 App Router, TypeScript, React client components, Tailwind (class-based dark mode), Prisma + SQLite, Vitest + Testing Library.

## Global Constraints

- **No schema migration** in this PR (all fields already exist: `SiteAudit.seoOnly`, `Schedule.payload.seoIntent`; `queueSiteAuditRequest` already accepts `seoOnly` and enforces `seoOnly ⇒ seoIntent`).
- **Dark mode on every new element** — Tailwind `dark:` variants (`bg-white`→`dark:bg-navy-card`, `text-gray-*`→`dark:text-white/*`, `border-gray-*`→`dark:border-navy-border`, orange accents). Design language: navy/orange, Barlow.
- **No hydration mismatch** — read `window.location.search`/`sessionStorage` only inside `useEffect` (never during render). Do **not** use `useSearchParams()` on `/seo-parser` (no `<Suspense>` boundary → client-render deopt + build warning).
- **Intent derived from `seoOnly`**, not `seoIntent` — a full-pipeline autonomous `seoIntent:true, seoOnly:false` audit is still an accessibility audit.
- **SEO intent default is off** — every toggle defaults to ADA; SEO is opt-in (preserves current behavior).
- Gate before PR: `npx tsc --noEmit` + `DATABASE_URL="file:./local-dev.db" npm test` + `NODE_OPTIONS='--max-old-space-size=3072' npm run build`.
- Spec: `docs/superpowers/specs/2026-07-08-seo-scan-toggles-design.md`.

### Test conventions (READ FIRST — Codex plan-review fixes)

This repo does **not** use jest-dom. Every snippet below obeys these house rules:
- **No `toBeInTheDocument()` / `toHaveAttribute()`.** Use `expect(screen.getByText('X')).toBeTruthy()`, `expect(screen.queryByText('X')).toBeNull()`, and `expect(el.getAttribute('href')).toBe('…')`.
- Component tests start with a `// @vitest-environment jsdom` header line (line 1 or 2).
- Mock `next/navigation` with the **`vi.hoisted`** pattern (see `QuickSiteAuditWidget.test.tsx`): `const pushMock = vi.hoisted(() => vi.fn()); vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))`. For components that also call `useSearchParams` (**`SiteAuditForm`** does — `prefillDomain`), add `useSearchParams: () => new URLSearchParams('')` to the same mock.
- `afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); pushMock.mockReset() })`.
- All `import` statements go at the **top** of the file (ESM) — never after an `it(...)`.
- To set the URL in a jsdom test, use `window.history.pushState({}, '', '/seo-parser?scan=NEW')` — do **not** redefine `window.location`.
- **DB-backed route/service tests** reuse the target file's existing harness (its `PREFIX`, `jsonReq`/`p(...)` helpers, and `beforeEach`/`afterEach` cleanup) — do not invent bare `prisma.create` calls with fixed names (they collide across runs).
- When a task adds a payload/response field, **update the existing exact-shape assertions** in that file's older tests (they will otherwise fail on the new `seoOnly:false` / `seoIntent:false` keys).
- **`WidgetSize`** is `'sm' | 'wide' | 'lg' | 'xl'` — use `size="wide"` (there is no `'md'`).

---

### Task 1: Shared intent helper + `IntentChip`

**Files:**
- Create: `lib/ada-audit/scan-intent.ts`
- Create: `lib/ada-audit/scan-intent.test.ts`
- Create: `components/ada-audit/IntentChip.tsx`
- Create: `components/ada-audit/IntentChip.test.tsx`

**Interfaces:**
- Produces: `type ScanIntent = 'ada' | 'seo'`; `scanIntentOf(a: { seoOnly?: boolean | null }): ScanIntent`; `SCAN_INTENT_LABEL: Record<ScanIntent, string>`; React `IntentChip({ seoOnly }: { seoOnly?: boolean | null })`.

- [ ] **Step 1: Write the failing helper test**

```ts
// lib/ada-audit/scan-intent.test.ts
import { describe, it, expect } from 'vitest'
import { scanIntentOf, SCAN_INTENT_LABEL } from './scan-intent'

describe('scanIntentOf', () => {
  it('maps seoOnly:true → seo', () => expect(scanIntentOf({ seoOnly: true })).toBe('seo'))
  it('maps seoOnly:false → ada', () => expect(scanIntentOf({ seoOnly: false })).toBe('ada'))
  it('maps missing/null → ada', () => {
    expect(scanIntentOf({})).toBe('ada')
    expect(scanIntentOf({ seoOnly: null })).toBe('ada')
  })
  it('labels', () => {
    expect(SCAN_INTENT_LABEL.seo).toBe('SEO')
    expect(SCAN_INTENT_LABEL.ada).toBe('Accessibility')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './scan-intent'`)

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/scan-intent.test.ts`

- [ ] **Step 3: Implement the helper**

```ts
// lib/ada-audit/scan-intent.ts
// Single source of truth for the ADA-vs-SEO scan-intent label. Intent is
// derived from seoOnly (the execution mode) — a full-pipeline seoIntent audit
// is still an accessibility audit. Pure + client-safe (no server imports).
export type ScanIntent = 'ada' | 'seo'

export function scanIntentOf(a: { seoOnly?: boolean | null }): ScanIntent {
  return a.seoOnly ? 'seo' : 'ada'
}

export const SCAN_INTENT_LABEL: Record<ScanIntent, string> = {
  ada: 'Accessibility',
  seo: 'SEO',
}
```

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Write the failing chip test**

Decision (Codex plan-review #10, Kevin to confirm in PR): in **dense queue/list rows** the chip flags only the **non-default** intent — it renders "SEO" for a seoOnly row and **nothing** for an ADA row (ADA is the 99% case; a chip on every row is visual noise). The explicit two-way choice lives in the form/schedule **toggles** (Tasks 3/4/8), not the row chip.

```tsx
// components/ada-audit/IntentChip.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { IntentChip } from './IntentChip'

afterEach(() => cleanup())

describe('IntentChip', () => {
  it('renders SEO for seoOnly', () => {
    render(<IntentChip seoOnly />)
    expect(screen.getByText('SEO')).toBeTruthy()
  })
  it('renders nothing for an ADA row (no noise)', () => {
    const { container } = render(<IntentChip seoOnly={false} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 6: Run it — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/IntentChip.test.tsx`

- [ ] **Step 7: Implement the chip (SEO-only)**

```tsx
// components/ada-audit/IntentChip.tsx
import { scanIntentOf, SCAN_INTENT_LABEL } from '@/lib/ada-audit/scan-intent'

/** Scan-intent badge for dense rows: renders the SEO label only; ADA (the
 *  default) renders nothing to avoid labeling every historical row. Explicit
 *  two-way intent lives in the form/schedule toggles, not here. */
export function IntentChip({ seoOnly }: { seoOnly?: boolean | null }) {
  if (scanIntentOf({ seoOnly }) !== 'seo') return null
  return (
    <span className="rounded bg-orange/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange dark:bg-orange/15">
      {SCAN_INTENT_LABEL.seo}
    </span>
  )
}
```

- [ ] **Step 8: Run it — expect PASS**

- [ ] **Step 9: Commit**

```bash
git add lib/ada-audit/scan-intent.ts lib/ada-audit/scan-intent.test.ts components/ada-audit/IntentChip.tsx components/ada-audit/IntentChip.test.tsx
git commit -m "feat(c11): shared scan-intent helper + IntentChip"
```

---

### Task 2: `SeoScanForm` — `?scan=` pickup, precedence, terminal error, 409-adopt

**Files:**
- Modify: `components/seo-parser/SeoScanForm.tsx`
- Modify: `components/seo-parser/SeoScanForm.test.tsx`

**Interfaces:**
- Consumes: `GET /api/site-audit/[id]` (`{status, liveScanRunId}`); `sessionStorage['seo-scan-id']`; `window.location.search`.
- Produces: nothing external (self-contained component behavior).

**Context — current bug:** `poll()` handles only `status === 'complete'`; `error`/`cancelled` fall to the `else` → `phase='running'` forever. Submit-409 currently sets `phase='error'`. There is no `?scan=` pickup.

- [ ] **Step 1: Write the failing tests** — merge these `import`s into the file's existing top-of-file import block (do not add imports after an `it`). If the file lacks the `// @vitest-environment jsdom` header, add it as line 1. Then add this `describe`:

```tsx
// top-of-file imports (merge, don't duplicate):
// import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// import { render, screen, waitFor, cleanup } from '@testing-library/react'
// import { SeoScanForm } from './SeoScanForm'

describe('SeoScanForm terminal + handoff (C11 PR 2a)', () => {
  beforeEach(() => { sessionStorage.clear(); window.history.pushState({}, '', '/seo-parser') })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('adopts ?scan= and polls it, overriding stale sessionStorage', async () => {
    sessionStorage.setItem('seo-scan-id', 'OLD')
    window.history.pushState({}, '', '/seo-parser?scan=NEW')
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/api/site-audit/NEW')   // must poll NEW, never OLD
      return { ok: true, json: async () => ({ status: 'running' }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SeoScanForm />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(sessionStorage.getItem('seo-scan-id')).toBe('NEW')
  })

  it('shows a terminal error on status:error and stops polling + clears storage', async () => {
    sessionStorage.setItem('seo-scan-id', 'X')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'error' }) } as Response)))
    render(<SeoScanForm />)
    await waitFor(() => expect(screen.getByText(/SEO scan failed/i)).toBeTruthy())
    expect(sessionStorage.getItem('seo-scan-id')).toBeNull()
  })

  it('treats status:cancelled as terminal error', async () => {
    sessionStorage.setItem('seo-scan-id', 'X')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'cancelled' }) } as Response)))
    render(<SeoScanForm />)
    await waitFor(() => expect(screen.getByText(/SEO scan failed/i)).toBeTruthy())
  })

  it('treats a 404 poll as terminal error', async () => {
    sessionStorage.setItem('seo-scan-id', 'X')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) } as Response)))
    render(<SeoScanForm />)
    await waitFor(() => expect(screen.getByText(/SEO scan failed/i)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/SeoScanForm.test.tsx`
Expected: new cases fail (still-running loop; no error text; polls OLD).

- [ ] **Step 3: Add the `error` message state + terminal handling in `poll()`**

In `SeoScanForm.tsx`, replace the `poll` callback body so it handles terminal states (keep the existing `complete`/`building`/`ready` branches):

```tsx
  const poll = useCallback(async (id: string) => {
    const res = await fetch(`/api/site-audit/${id}`);
    if (!res.ok) {
      if (res.status === 404) {
        setError('SEO scan failed — the scan could not be found.');
        setPhase('error');
        try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      }
      return; // other non-OK → transient, keep polling
    }
    const d = await res.json();
    if (d.status === 'error' || d.status === 'cancelled') {
      setError('SEO scan failed — please try again.');
      setPhase('error');
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      return;
    }
    if (d.status === 'complete' && d.liveScanRunId) {
      setRunId(d.liveScanRunId);
      setPhase('ready');
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    } else if (d.status === 'complete') {
      setPhase('building');
    } else {
      setPhase('running');
    }
  }, []);
```

- [ ] **Step 4: Stop the poll interval on `error` too**

Change the polling effect's early-return guard from `phase === 'ready'` to also cover `error`:

```tsx
  useEffect(() => {
    if (!auditId || phase === 'ready' || phase === 'error') return;
    void poll(auditId);
    timer.current = setInterval(() => { void poll(auditId); }, 2000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [auditId, phase, poll]);
```

- [ ] **Step 5: `?scan=` pickup with precedence over sessionStorage**

Replace the existing mount effect (the one reading `sessionStorage.getItem(STORAGE_KEY)`) with:

```tsx
  // On mount: a ?scan=<id> handoff (from SiteAuditForm / QuickSiteAuditWidget)
  // WINS over a stale sessionStorage id; otherwise resume a stored pending scan.
  // Read in an effect (never during render) — no hydration mismatch, no
  // useSearchParams (this page has no Suspense boundary).
  useEffect(() => {
    let id: string | null = null;
    try {
      const q = new URLSearchParams(window.location.search).get('scan');
      if (q) {
        id = q;
        try { sessionStorage.setItem(STORAGE_KEY, q); } catch { /* ignore */ }
      } else {
        id = sessionStorage.getItem(STORAGE_KEY);
      }
    } catch { /* sessionStorage/location unavailable — degrade silently */ }
    if (id) {
      setAuditId(id);
      setRunId(null);
      setError(null);
      setPhase('running');
    }
  }, []);
```

- [ ] **Step 6: Submit 409 → adopt the existing id and poll it**

In `submit()`, replace the `res.status === 409` branch:

```tsx
    if (res.status === 409 && d.id) {
      setAuditId(d.id);
      setRunId(null);
      setPhase('running');
      try { sessionStorage.setItem(STORAGE_KEY, d.id); } catch { /* ignore */ }
      return;
    }
```

- [ ] **Step 7: Render the terminal error message**

The component already renders `{error && (<div …>{error}</div>)}` — confirm it displays in the `error` phase (it does, `error` state is set). No change needed beyond Steps 3/6 setting `error`.

- [ ] **Step 8: Run — expect PASS** (all four new cases + existing cases green)

- [ ] **Step 9: Commit**

```bash
git add components/seo-parser/SeoScanForm.tsx components/seo-parser/SeoScanForm.test.tsx
git commit -m "fix(c11): SeoScanForm terminal error + ?scan= handoff (precedence over storage)"
```

---

### Task 3: `SiteAuditForm` intent toggle + SEO routing

**Files:**
- Modify: `components/ada-audit/SiteAuditForm.tsx`
- Create: `components/ada-audit/SiteAuditForm.test.tsx` (if absent; else modify)

**Interfaces:**
- Consumes: `POST /api/site-audit` (`{domain, clientId, wcagLevel, urls, seoOnly}` → 202 `{id,status}` / 409 `{error,id,seoOnly}`).
- Produces: nothing external.

- [ ] **Step 1: Write the failing test**

```tsx
// components/ada-audit/SiteAuditForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(''),   // SiteAuditForm uses this (prefillDomain)
}))

import SiteAuditForm from './SiteAuditForm'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); pushMock.mockReset() })

describe('SiteAuditForm SEO intent (C11 PR 2a)', () => {
  it('SEO intent sends seoOnly:true and routes to /seo-parser?scan=', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/clients') return { json: async () => [] } as Response
      if (url === '/api/site-audit') {
        const body = JSON.parse(String(init!.body))
        expect(body.seoOnly).toBe(true)
        return { ok: true, status: 202, json: async () => ({ id: 'A1', status: 'queued' }) } as Response
      }
      return { ok: true, json: async () => ({ urls: ['https://x.edu/'], domain: 'x.edu' }) } as Response // discovery
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SiteAuditForm queueStatus={null} />)
    fireEvent.click(screen.getByRole('button', { name: /SEO/i }))          // intent toggle
    fireEvent.change(screen.getByLabelText(/Domain to audit/i), { target: { value: 'x.edu' } })
    fireEvent.click(screen.getByRole('button', { name: /Discover|Scan/i }))
    await waitFor(() => screen.getByRole('button', { name: /Audit|Scan .*page/i }))
    fireEvent.click(screen.getByRole('button', { name: /Audit|Scan .*page/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/seo-parser?scan=A1'))
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditForm.test.tsx`

- [ ] **Step 3: Add intent state + toggle control**

After the `wcagLevel` state (line ~64) add:

```tsx
  const [intent, setIntent] = useState<'ada' | 'seo'>('ada')
```

Insert this segmented control just **above** the WCAG-level block (before line ~441, the `{/* WCAG level selector */}` comment):

```tsx
      {/* Scan intent */}
      <div>
        <p id="scan-intent-label" className="block text-[13px] font-body font-semibold text-navy/70 dark:text-white/70 mb-1.5">
          Scan type
        </p>
        <div role="group" aria-labelledby="scan-intent-label" className="flex gap-2">
          {([
            { value: 'ada', label: 'Accessibility', badge: 'ADA + SEO data' },
            { value: 'seo', label: 'SEO', badge: 'Render-only, faster' },
          ] as const).map(({ value, label, badge }) => (
            <button
              key={value}
              type="button"
              aria-pressed={intent === value}
              onClick={() => setIntent(value)}
              disabled={isBusy}
              className={`flex-1 flex flex-col items-center px-3 py-2 rounded-lg border text-[13px] font-body transition-colors disabled:opacity-50 ${
                intent === value
                  ? 'border-orange bg-orange/5 text-orange font-semibold'
                  : 'border-gray-300 dark:border-navy-border text-navy dark:text-white hover:border-gray-400'
              }`}
            >
              <span>{label}</span>
              <span className={`text-[11px] font-normal mt-0.5 ${intent === value ? 'text-orange/70' : 'text-navy/40 dark:text-white/40'}`}>{badge}</span>
            </button>
          ))}
        </div>
      </div>
```

- [ ] **Step 4: Hide the WCAG selector under SEO intent**

Wrap the existing `{/* WCAG level selector */}` `<div>` block in `{intent === 'ada' && ( … )}` (WCAG is meaningless for a render-only scan; a default `wcag21aa` is still sent).

- [ ] **Step 5: Thread `seoOnly` into both POST bodies + branch routing**

In `handleStartAudit` (body ~183-188) and `handleStartManualAudit` (body ~243-248), add `seoOnly: intent === 'seo',` to each `JSON.stringify({...})`.

Then replace **both** success/409 routing spots in each handler. For `handleStartAudit`:

```tsx
      const data = await res.json()
      const dest = intent === 'seo' ? `/seo-parser?scan=${data.id}` : `/ada-audit/site/${data.id}`
      if (!res.ok) {
        if (res.status === 409 && data.id) {
          setError('A site audit for this domain is already running.')
          setIsRunning(false)
          router.push(dest)
          return
        }
        setError(data.error ?? 'Request failed')
        setIsRunning(false)
        return
      }
      router.push(dest)
```

Apply the identical `dest` + `router.push(dest)` change in `handleStartManualAudit`.

- [ ] **Step 6: Run — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add components/ada-audit/SiteAuditForm.tsx components/ada-audit/SiteAuditForm.test.tsx
git commit -m "feat(c11): SiteAuditForm scan-intent toggle + SEO routing to /seo-parser?scan="
```

---

### Task 4: `QuickSiteAuditWidget` intent toggle + routing by local intent

**Files:**
- Modify: `components/widgets/QuickSiteAuditWidget.tsx`
- Modify: `components/widgets/QuickSiteAuditWidget.test.tsx`

**Interfaces:**
- Consumes: `POST /api/site-audit` (202 `{id,status}` — **no `seoOnly`**; 409 `{error,id,seoOnly}`).

**Context:** the widget currently routes on `data.seoOnly`, which is absent on 202 → a new SEO scan wrongly hits `/ada-audit/site/:id`. Route by **local** intent.

- [ ] **Step 1: Write the failing test** (append inside the existing `describe`; the file already imports `fireEvent`, uses `pushMock` via `vi.hoisted`, and `size="wide"`)

```tsx
it('C11: new SEO 202 (no seoOnly in body) routes by local intent to /seo-parser?scan=', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body))
    expect(body.seoOnly).toBe(true)
    return { status: 202, ok: true, json: async () => ({ id: 'Q1', status: 'queued' }) } as Response
  }))
  render(<QuickSiteAuditWidget size="wide" />)
  fireEvent.click(screen.getByRole('button', { name: /SEO/i }))
  fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'x.edu' } })
  fireEvent.click(screen.getByRole('button', { name: /start/i }))
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/seo-parser?scan=Q1'))
})
```

- [ ] **Step 1b: Update the existing seoOnly-409 test** — the current case
  `'C11: routes a seoOnly 409 duplicate to /seo-parser'` expects `push('/seo-parser')`.
  After this task the widget appends `?scan=`, so change its expectation to
  `expect(pushMock).toHaveBeenCalledWith('/seo-parser?scan=dup')`.

- [ ] **Step 2: Run — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/widgets/QuickSiteAuditWidget.test.tsx`

- [ ] **Step 3: Add intent state + a compact toggle**

Add after `wcagLevel` state:

```tsx
  const [intent, setIntent] = useState<'ada' | 'seo'>('ada')
```

Insert above the `size !== 'sm'` WCAG `<select>`:

```tsx
      <div role="group" aria-label="Scan type" className="flex gap-1 text-[12px]">
        {(['ada', 'seo'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={intent === v}
            onClick={() => setIntent(v)}
            className={`flex-1 rounded-lg border px-2 py-1 font-semibold transition-colors ${
              intent === v
                ? 'border-orange bg-orange/5 text-orange'
                : 'border-gray-300 text-navy dark:border-navy-border dark:text-white'
            }`}
          >
            {v === 'ada' ? 'Accessibility' : 'SEO'}
          </button>
        ))}
      </div>
```

Optionally hide the WCAG `<select>` under `intent === 'seo'` (wrap its `{size !== 'sm' && (…)}` with `intent === 'ada' && …`).

- [ ] **Step 4: Thread `seoOnly` + route by local intent**

Change the POST body to include intent, and route locally:

```tsx
      const res = await fetch('/api/site-audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: value, wcagLevel, clientId: null, seoOnly: intent === 'seo' }),
      })
      const data = await res.json().catch(() => ({}))
      if ((res.status === 202 || res.status === 409) && data.id) {
        const seo = intent === 'seo' || data.seoOnly === true
        router.push(seo ? `/seo-parser?scan=${data.id}` : `/ada-audit/site/${data.id}`)
        return
      }
```

- [ ] **Step 5: Run — expect PASS** (new case + existing ADA case)

- [ ] **Step 6: Commit**

```bash
git add components/widgets/QuickSiteAuditWidget.tsx components/widgets/QuickSiteAuditWidget.test.tsx
git commit -m "feat(c11): QuickSiteAuditWidget scan-intent toggle + local-intent routing"
```

---

### Task 5: Schedules POST route — accept `seoOnly`, coerce before uniqueness

**Files:**
- Modify: `app/api/clients/[id]/schedules/route.ts`
- Create/Modify: `app/api/clients/[id]/schedules/route.test.ts`

**Interfaces:**
- Produces: Schedule rows whose payload is `{clientId, domain, wcagLevel, seoIntent, seoOnly}`.

- [ ] **Step 1: Write the failing tests** — **reuse the file's existing harness** (its `PREFIX` for unique client names, its request helper — call it `jsonReq`/`p(...)` per the file — and its `beforeEach`/`afterEach` cleanup). Do not seed bare fixed-name clients. Add two cases (illustrative bodies; adapt to the file's helpers):

```ts
// seoOnly without seoIntent coerces to seoIntent:true, persists both
it('coerces seoOnly⇒seoIntent before uniqueness and persists both', async () => {
  const client = await seedClient(['t.edu'])                          // via the file's helper
  const res = await postSchedule(client.id, { domain: 't.edu', cadence: 'weekly:1@06:00', seoOnly: true })
  expect(res.status).toBe(201)
  const row = await prisma.schedule.findUnique({ where: { id: (await res.json()).id } })
  const pl = JSON.parse(row!.payload)
  expect(pl.seoOnly).toBe(true)
  expect(pl.seoIntent).toBe(true)
})

// an ADA and an SEO schedule coexist for the same domain; a same-intent dup 409s
it('coexists ADA + SEO schedules for one domain', async () => {
  const client = await seedClient(['t2.edu'])
  const mk = (extra: object) => postSchedule(client.id, { domain: 't2.edu', cadence: 'weekly:1@06:00', ...extra })
  expect((await mk({})).status).toBe(201)                 // ADA
  expect((await mk({ seoOnly: true })).status).toBe(201)  // SEO — different seoIntent
  expect((await mk({})).status).toBe(409)                 // duplicate ADA
})
```

- [ ] **Step 1b: Update older exact-payload assertions** — any existing test asserting the created payload equals exactly `{clientId, domain, wcagLevel, seoIntent}` must be updated to include `seoOnly:false` (and the ADA default `seoIntent:false`), or switched to `expect.objectContaining`.

- [ ] **Step 2: Run — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/clients/[id]/schedules/route.test.ts`

- [ ] **Step 3: Coerce before uniqueness + persist `seoOnly`**

Replace the `const wcagLevel … const seoIntent …` block (lines ~88-89) with:

```ts
  const wcagLevel = body.wcagLevel === 'wcag22aa' ? 'wcag22aa' : 'wcag21aa'
  const seoOnly = body.seoOnly === true
  const seoIntent = body.seoIntent === true || seoOnly // seoOnly ⇒ seoIntent
```

The existing uniqueness check already keys on `seoIntent` (compares `(p?.seoIntent === true) === seoIntent`) — it now uses the coerced value. Update the `create` payload (line ~113):

```ts
      payload: JSON.stringify({ clientId, domain, wcagLevel, seoIntent, seoOnly }),
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add "app/api/clients/[id]/schedules/route.ts" "app/api/clients/[id]/schedules/route.test.ts"
git commit -m "feat(c11): schedules route accepts seoOnly, coerces before uniqueness"
```

---

### Task 6: `scheduled-site-audit.ts` — parse + forward `seoOnly`

**Files:**
- Modify: `lib/jobs/handlers/scheduled-site-audit.ts`
- Modify: `lib/jobs/handlers/scheduled-site-audit.test.ts`

**Interfaces:**
- Consumes: Schedule payload `{…, seoOnly?}`.
- Produces: `queueSiteAuditRequest({… seoOnly})` call.

- [ ] **Step 1: Write the failing test** (mock `queueSiteAuditRequest`, assert the flag flows through)

```ts
it('forwards seoOnly:true from the payload to queueSiteAuditRequest', async () => {
  // Arrange a schedule + job whose payload carries seoOnly:true, then run the
  // registered handler; spy on the dynamically-imported queueSiteAuditRequest.
  // Assert it was called with seoOnly:true. (Follow the existing test's mocking
  // of '@/lib/ada-audit/queue-request'.)
})
```

(Write the concrete arrange/act using the file's existing test harness — it already mocks `queueSiteAuditRequest`; add a `seoOnly:true` payload variant and assert `expect(queueSiteAuditRequest).toHaveBeenCalledWith(expect.objectContaining({ seoOnly: true }))`, and a control asserting absent payload → `seoOnly: false`.)

- [ ] **Step 1b: Update the existing full-call assertion** — the file's current "enqueues via queueSiteAuditRequest" case asserts the **entire** call object. Adding `seoOnly` forwarding means that object now includes `seoOnly: false`; update that assertion (add the key, or relax to `expect.objectContaining`).

- [ ] **Step 2: Run — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/scheduled-site-audit.test.ts`

- [ ] **Step 3: Add `seoOnly` to the payload type + parse + forward**

In the `ScheduledSiteAuditPayload` interface add `seoOnly?: boolean`. In `parsePayload`, add `const seoOnly = p.seoOnly === true` and return it. Replace the `// FUTURE (efficiency)…` comment block (lines ~102-105) with:

```ts
      // C11 PR 2a: seoOnly schedules run the render-only path (skip axe/
      // screenshots/PSI); the live-scan run is still built post-terminal.
      // Legacy seoIntent-only schedules stay full-pipeline (seoOnly:false).
```

And add `seoOnly: p.seoOnly ?? false,` to the `queueSiteAuditRequest({...})` call (it already forces `seoIntent` when `seoOnly` is true).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/scheduled-site-audit.ts lib/jobs/handlers/scheduled-site-audit.test.ts
git commit -m "feat(c11): scheduled-site-audit forwards seoOnly (render-only SEO schedules)"
```

---

### Task 7: `getClientSchedules` — SEO last-run score/link, no ADA diff

**Files:**
- Modify: `lib/services/client-schedules.ts`
- Modify: `lib/services/client-schedules.test.ts` (or the nearest existing DB test)

**Interfaces:**
- Produces: `ClientScheduleRow` gains `seoOnly: boolean` and `liveRunId: string | null` (the live-scan run id, for the card's SEO link).

- [ ] **Step 1: Write the failing test**

```ts
it('a seoOnly schedule sources score from the live-scan run and skips ADA diff', async () => {
  // Seed: client, an SEO schedule (payload seoOnly:true), a completed SiteAudit
  // with a CrawlRun {tool:'seo-parser', source:'live-scan', score: 77} and NO
  // ada-audit run. Expect: row.seoOnly === true, row.lastRun.score === 77,
  // row.lastRun.newCount === null, row.lastDelta === null, row.liveRunId set.
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-schedules.test.ts`

- [ ] **Step 3: Select the live-scan run + branch on intent**

In the `siteAudit.findMany` select, broaden `crawlRuns` to include the live-scan run:

```ts
      crawlRuns: {
        where: { OR: [{ tool: 'ada-audit' }, { tool: 'seo-parser', source: 'live-scan' }] },
        select: { id: true, tool: true, source: true, score: true, scoreBreakdown: true },
      },
```

Parse `seoOnly` in the payload try-block (`if (p?.seoOnly === true) seoOnly = true`, with `let seoOnly = false` initialised). Then compute the last-run score/diff **by intent**. **Type the finders** off the query result to satisfy `noImplicitAny` (do not use bare `(a) =>`):

```ts
    type AuditRow = typeof audits[number]
    const adaRun = (a: AuditRow | null) => a?.crawlRuns.find((r) => r.tool === 'ada-audit') ?? null
    const liveRun = (a: AuditRow | null) => a?.crawlRuns.find((r) => r.tool === 'seo-parser') ?? null

    const mine = audits.filter((a) => a.scheduleId === s.id)
    const last = mine[0] ?? null

    if (seoOnly) {
      // SEO schedule: score from the live-scan run; NO ADA instance-diff
      // (getRunPairInstanceDiff rejects non-ada runs). Delta null in 2a.
      const lr = liveRun(last)
      return {
        id: s.id, domain, wcagLevel, cadence: s.cadence, enabled: s.enabled,
        nextRunAt: s.nextRunAt.toISOString(), seoIntent, seoOnly, liveRunId: lr?.id ?? null,
        lastRun: last ? {
          id: last.id, status: last.status, completedAt: last.completedAt?.toISOString() ?? null,
          score: lr?.score ?? null, newCount: null, resolvedCount: null,
        } : null,
        lastDelta: null,
      }
    }
```

Keep the existing ADA path below this branch, but **exhaustively** swap every index-`0` crawlRuns read to the typed finder so the newly-included live-scan run can never be mistaken for the ADA run (Codex plan-review #7). The complete list of reads to change from `X.crawlRuns[0]` → `adaRun(X)`:
- `lastScore` = `adaRun(last)?.score ?? null`
- the `prevAudit` predicate = `a.status === 'complete' && typeof adaRun(a)?.score === 'number'`
- `prevScore` = `adaRun(prevAudit)?.score ?? null`
- the `getRunPairInstanceDiff(adaRun(last)!.id, adaRun(prevAudit)!.id)` args (and the `last.crawlRuns[0] && prevAudit.crawlRuns[0]` guard → `adaRun(last) && adaRun(prevAudit)`)
- both `parseScoreVersion(adaRun(last)?.scoreBreakdown)` / `parseScoreVersion(adaRun(prevAudit)?.scoreBreakdown)`

Then add `seoOnly: false, liveRunId: null,` to the ADA path's returned object. (Adding a second run to the `crawlRuns` array is safe **only** because none of these still use index `0`.)

- [ ] **Step 4: Add the two fields to `ClientScheduleRow`**

```ts
  seoOnly: boolean
  /** C11: the live-scan run id for a seoOnly schedule's last run (SEO results link). */
  liveRunId: string | null
```

- [ ] **Step 5: Run — expect PASS** (new SEO case + existing ADA cases still green)

- [ ] **Step 6: Commit**

```bash
git add lib/services/client-schedules.ts lib/services/client-schedules.test.ts
git commit -m "feat(c11): getClientSchedules SEO last-run (live-scan score/link, no ADA diff)"
```

---

### Task 8: `ScheduledScansCard` — intent select + chip + SEO last-run link

**Files:**
- Modify: `components/clients/ScheduledScansCard.tsx`
- Modify: `components/clients/ScheduledScansCard.test.tsx`

**Interfaces:**
- Consumes: `IntentChip` (Task 1); `ClientScheduleRow.seoOnly`/`liveRunId` (Task 7); `POST /api/clients/[id]/schedules` (Task 5).

- [ ] **Step 1: Write the failing tests** (this file has a `// @vitest-environment jsdom` header and helpers already; add `waitFor`/`cleanup` to its imports if missing)

```tsx
it('creating an SEO schedule posts seoOnly:true + seoIntent:true', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const b = JSON.parse(String(init.body))
      expect(b.seoOnly).toBe(true); expect(b.seoIntent).toBe(true)
      return { ok: true, json: async () => ({ id: 's1' }) } as Response
    }
    return { ok: true, json: async () => ({ schedules: [] }) } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<ScheduledScansCard clientId={1} domains={['t.edu']} archived={false} initial={[]} />)
  fireEvent.click(screen.getByText('+ Add schedule'))
  fireEvent.change(screen.getByLabelText(/Scan type/i), { target: { value: 'seo' } })
  fireEvent.click(screen.getByText('Create'))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/clients/1/schedules', expect.objectContaining({ method: 'POST' })))
})

it('an SEO schedule row shows the SEO chip and links last run to the live run', () => {
  render(<ScheduledScansCard clientId={1} domains={['t.edu']} archived={false} initial={[{
    id: 's1', domain: 't.edu', wcagLevel: 'wcag21aa', cadence: 'weekly:1@06:00', enabled: true,
    nextRunAt: new Date().toISOString(), seoIntent: true, seoOnly: true, liveRunId: 'R1',
    lastRun: { id: 'A1', status: 'complete', completedAt: null, score: 80, newCount: null, resolvedCount: null },
    lastDelta: null,
  }]} />)
  expect(screen.getByText('SEO')).toBeTruthy()
  expect(screen.getByRole('link', { name: /complete/i }).getAttribute('href')).toBe('/seo-parser/results/run/R1')
})
```

- [ ] **Step 1b: Update the file's shared fixtures/assertions** — the existing shared `row`/`initial` `ClientScheduleRow` constant(s) must gain `seoOnly: false` and `liveRunId: null` (new required fields from Task 7) or `tsc` fails. Any existing create-flow test asserting the POST body equals exactly `{domain, cadence, wcagLevel}` must be updated to include `seoIntent:false, seoOnly:false` (or use `expect.objectContaining`).

- [ ] **Step 2: Run — expect FAIL**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/ScheduledScansCard.test.tsx`

- [ ] **Step 3: Add intent state + select + hide WCAG under SEO**

Add `const [intent, setIntent] = useState<'ada' | 'seo'>('ada')`. Add a labeled `<select>` in the create form (near the WCAG-level select ~148-154):

```tsx
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 dark:text-white/50">Scan type</span>
            <select aria-label="Scan type" value={intent} onChange={(e) => setIntent(e.target.value as 'ada' | 'seo')} className={inputCls}>
              <option value="ada">Accessibility</option>
              <option value="seo">SEO</option>
            </select>
          </label>
```

Wrap the WCAG-level `<label>` in `{intent === 'ada' && ( … )}`.

- [ ] **Step 4: Send `seoOnly`/`seoIntent` in `create()`**

```tsx
        body: JSON.stringify({
          domain,
          cadence: freq === 'weekly' ? `weekly:${day}@${time}` : `monthly:${day}@${time}`,
          wcagLevel: level,
          seoIntent: intent === 'seo',
          seoOnly: intent === 'seo',
        }),
```

- [ ] **Step 5: Render the chip + SEO-aware last-run link**

Import `IntentChip`. In each schedule `<li>`, add `<IntentChip seoOnly={s.seoOnly} />` next to the domain. Replace the last-run link so SEO schedules don't point at the ADA page:

```tsx
              {s.lastRun && (
                <span className="text-gray-500 dark:text-white/50">
                  last:{' '}
                  <a
                    href={s.seoOnly
                      ? (s.liveRunId ? `/seo-parser/results/run/${s.liveRunId}` : `/seo-parser?scan=${s.lastRun.id}`)
                      : `/ada-audit/site/${s.lastRun.id}`}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {s.lastRun.status}
                    {s.lastRun.score !== null ? ` · ${s.lastRun.score}` : ''}
                  </a>
                  {/* delta/new/resolved chips render as before (null for SEO in 2a) */}
```

(Leave the existing `lastDelta`/`newCount`/`resolvedCount` chip markup — all null for SEO rows, so nothing shows.)

- [ ] **Step 6: Run — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add components/clients/ScheduledScansCard.tsx components/clients/ScheduledScansCard.test.tsx
git commit -m "feat(c11): ScheduledScansCard intent select + SEO chip + SEO last-run link"
```

---

### Task 9: Labeling pass on queue + scan-trigger surfaces

**Files:**
- Modify: `components/ada-audit/QueueMemberRow.tsx`
- Modify: `components/ada-audit/DashboardQueueStatus.tsx`
- Modify: `components/ada-audit/SiteAuditForm.tsx` (queue banner)
- Modify: `components/widgets/LiveNowWidget.tsx`
- Modify: existing tests for each where present; add a focused render test per component.

**Interfaces:**
- Consumes: `IntentChip` (Task 1). All rows already carry `seoOnly` (`AuditBatchMember`, `QueueStatusWithBatch.active`/`.queued[]`).

- [ ] **Step 1: Write failing render tests on currently-unlabeled surfaces.** `QueueMemberRow` already shows an inline "SEO" today (PR 1), so asserting "SEO" there is **not** red — instead assert the **currently-unlabeled** surfaces (`DashboardQueueStatus` queued list, `SiteAuditForm` queued banner, `LiveNowWidget`), plus a consistency check that ADA rows show no chip. Example (matchers per house rules, `// @vitest-environment jsdom`):

```tsx
it('DashboardQueueStatus queued list shows the SEO chip for a seoOnly item', () => {
  // render DashboardQueueStatus with a queueStatus whose queued[] has a seoOnly:true item
  // (build the minimal QueueStatusWithBatch the component consumes)
  render(/* <DashboardQueueStatus …/> with one seoOnly queued item + one ADA queued item */)
  expect(screen.getByText('SEO')).toBeTruthy()          // seoOnly item labeled
  // ADA item shows NO chip (SEO-only chip); assert exactly one 'SEO' in the queued list
  expect(screen.getAllByText('SEO').length).toBe(1)
})
```

  For `QueueMemberRow`, assert the **shared** chip replaced the inline badge by checking an ADA member renders no "SEO" text (`expect(screen.queryByText('SEO')).toBeNull()`) and a seoOnly member renders exactly one — this locks the SEO-only behavior in.

- [ ] **Step 2: Run — expect FAIL** (unlabeled surfaces have no chip yet)

- [ ] **Step 3: `QueueMemberRow`** — replace the inline PR-1 `member.seoOnly && <span…>SEO</span>` marker with `<IntentChip seoOnly={member.seoOnly} />` (import it). Keep the `member.seoOnly ? '/seo-parser' : …` link target.

- [ ] **Step 4: `DashboardQueueStatus`** — in `QueueListContent` (queued list, ~192-206) render `<IntentChip seoOnly={item.seoOnly} />` before each domain; in `CurrentScanContent`/the active card replace the `'· SEO'` string (~130) with `<IntentChip seoOnly={active.seoOnly} />`.

- [ ] **Step 5: `SiteAuditForm` queue banner** — in the active row (~478) and each queued domain (~494-501) render `<IntentChip seoOnly={…} />` beside the domain (the active object + `queueStatus.queued[]` items carry `seoOnly`).

- [ ] **Step 6: `LiveNowWidget`** — replace its two inline seoOnly badges (~44, ~66) with `<IntentChip seoOnly={…} />`.

- [ ] **Step 7: Run all four component tests — expect PASS**

- [ ] **Step 8: Commit**

```bash
git add components/ada-audit/QueueMemberRow.tsx components/ada-audit/DashboardQueueStatus.tsx components/ada-audit/SiteAuditForm.tsx components/widgets/LiveNowWidget.tsx components/**/*.test.tsx
git commit -m "feat(c11): intent-labeling pass on queue + scan-trigger surfaces (IntentChip)"
```

---

### Task 10: Full gate + PR

- [ ] **Step 1: Typecheck** — `npx tsc --noEmit` (expect clean)
- [ ] **Step 2: Tests** — `DATABASE_URL="file:./local-dev.db" npm test` (expect all green)
- [ ] **Step 3: Build** — `NODE_OPTIONS='--max-old-space-size=3072' npm run build` (expect success)
- [ ] **Step 4: Dark-mode + hydration eyeball** — every new element has `dark:` variants; no `window`/`sessionStorage`/search read during render.
- [ ] **Step 5: Push + open PR** against `main` with a summary + the "no migration" note.

## Self-Review notes (spec coverage)

- (a) SiteAuditForm toggle+routing → Task 3; quick widget → Task 4. ✓
- (b) schedule toggle → Tasks 5 (route) + 6 (handler) + 7 (last-run) + 8 (card). ✓
- (c) labeling → Task 9 (scoped to queue + scan-trigger; RecentsTable/findings panels excluded per spec §4.4). ✓ Shared helper/chip → Task 1. ✓
- (error) SeoScanForm terminal + `?scan=` + 409-adopt → Task 2. ✓
- No migration; all data fields pre-exist. ✓
- Types: `ScanIntent`, `scanIntentOf`, `SCAN_INTENT_LABEL`, `IntentChip` consistent across Tasks 1/3/4/8/9; `ClientScheduleRow.seoOnly`/`liveRunId` defined in Task 7, consumed in Task 8. ✓
