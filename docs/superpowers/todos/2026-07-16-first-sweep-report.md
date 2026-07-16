# First weekly-sweep run — full report (test run, 2026-07-16)

Manually-fired test of the C21 weekly sweep + digest, immediately after the
verifier memory/loop fix (PR #186) + C21 deploy. Slot `2026-07-16T01:00Z`
(backdated so the digest's exact-slot lookup matched). The real cadence is
untouched — both schedules re-advanced themselves to Mon 2026-07-20.

## Headline numbers (spec §11)

| Metric | Value |
|---|---|
| Cohort | 29 members (29 active clients, 1 domain each; 1 straggler C2 schedule retired pre-sweep) |
| Fan-out → fully drained | 13:29:31Z → 18:09:27Z = **4h 40m** (well inside the 01:00→14:00 Monday window) |
| Audits completed | **29/29, zero audit-level failures** |
| Snapshot coverage | **scanned 29 / expected 29 = 100%** (spec bar ≥90%) |
| Live-scan (verifier) runs | 29/29 written; **0 exhausted placeholders, 0 RSS-guard trips, 0 dual-write failures, 0 error jobs** |
| Digest | fired 18:10:56Z, attempt 1, snapshot published + email sent to support@enrollmentresources.com; `/issues` serves the same frozen payload |
| Actionable issue groups | 226 (all `NEW` — first baseline, `comparablePairs 0` as designed) |
| PM2 | restarts never moved from baseline; memory band 442–856MB vs the 2400M kill line (old builder: single audits peaked ~2.7GB marginal) |
| Bonus resilience proof | a parallel-lane deploy (PR #193) bounced the app mid-sweep at 16:43Z — startup recovery resumed the in-flight audit (85+ outstanding jobs) with zero losses |

Kill switch verified: `topicOverlapJson` null on all 29 runs (embedder never
loaded). Content budget: no stubs — all sites fit inside the 24MB text budget
(`sim`/`sig` computed on all 29). One score-null run:
`proway.erstaging.site` (staging site → noindex → honest unscoreable null).

## Page-level error log (~116 error pages across 21 of 29 domains)

Zero audits failed; these are individual pages that errored inside otherwise
complete audits (each audit's `pagesError`). Four buckets, in priority order:

### Bucket 1 — stale/dead URLs in client sitemaps (~85 pages, CLIENT work)
Real 404s that the clients' sitemaps still advertise. Worst offenders:
- **healthcarecareercollege.edu: 35 pages** (whole program/careers sections: `/phlebotomy-*`, `/massage-*`, `/patient-care-*`, …)
- **cw.edu: ~13 pages** (`/virtual/`, `/cwcf-scholarship*`, `/financial-aid-workshops`, …)
- **innovatesalonacademy.com: 11 pages** (gainful-employment template files + `?page_id=3744`)
- online.hilbert.edu 4, manhattanschool.edu 4, sws.edu 3, prismcareerinstitute.edu 2, urbanriver.edu 2, beonair.com 2, others 1-2 each.
These are legitimate client findings (sitemap hygiene / redirect mapping) —
exactly what the weekly digest exists to surface. Note: page-level 404s do
NOT currently appear in the /issues groups (they're audit errors, not
findings) — triage decision needed on whether to surface them.

### Bucket 2 — `/cdn-cgi/l/email-protection` pseudo-pages (~8 domains, TOOL fix)
Cloudflare email-obfuscation URLs getting into the audited page set (one per
affected domain, always 404). Tool improvement: exclude `/cdn-cgi/` paths at
discovery/harvest. One-line filter + test.

### Bucket 3 — `Protocol error (Target.createTarget)` (6 pages, 5 domains, TOOL fix)
Chrome refusing a new tab under load (beal.edu ×3, sdgku.edu, valley.edu,
discoverycommunitycollege.com; plus one `Target closed` on soma.edu).
Transient infra — candidates for one page-level retry before settling the
child as error. Needs the architecture-contract's retry-layer discipline
(domain vs infrastructure error).

### Bucket 4 — HTTP 301 "puppeteer did not auto-follow" (~8 pages, TOOL investigate)
Redirect pages settled as errors with odd chains (e.g. bidwelltraining.edu
`https://…/academic-support-services/` → `http://bidwelltraining.edu/` while
final URL reads `https://…/`; prismcareerinstitute legacy `.php` URLs →
clean paths). Some are legitimate client redirect-hygiene findings; the
http/https flip-flop chains suggest a runner redirect-normalization quirk
worth a look. One `Response is not HTML (rss+xml)` on cw.edu/jobs/ is
CORRECT behavior (not an error to fix).

## Observations / follow-ups fed by this run

1. **`reason: "timed-out"` mislabel confirmed at scale**: 23/29 domains show
   coverage `partial` with reason `timed-out`, but the actual cause was
   pagesError>0 (a few 404s). The partial classification is HONEST; the
   reason label is wrong. Was a "label-only" follow-up from the C21 final
   review — real-data confirmation bumps its priority (the digest/issues UI
   tells support "timed out" 23 times when nothing timed out).
2. Because most domains have a handful of dead sitemap URLs, most pairs will
   sit in `partial` coverage indefinitely → downward claims (FEWER/resolved)
   will rarely be provable. Fixing buckets 1-2 (client sitemap hygiene + the
   cdn-cgi filter) directly increases future comparable coverage.
3. `proway.erstaging.site` is registered as client 31's domain — a staging
   site in the weekly sweep. Kevin: intentional?
4. ADA runs are `partial` wherever pagesError>0 — consistent and honest.

## Verdict

Both 2026-07-16 incident-class defenses held under the exact incident load
shape, end to end, with a mid-sweep deploy thrown in for free. The sweep,
snapshot, /issues freeze, and digest email all behaved to spec on the first
real firing. Monday 2026-07-20's automatic run needs no babysitting — a
glance at the digest email suffices.
