# Small Tools (Robots Validator · RankMath Redirects) — Improvement Roadmap

**Date:** 2026-06-10 · **Status:** NYI strategy doc
**Scope:** `app/robots-validator/page.tsx` (835 LOC), `app/rankmath-redirects/page.tsx` (445 LOC), `lib/validators/**` (robots 320 LOC, sitemap 168 LOC), `app/api/fetch-url`

---

## Current state (verified)

- **Robots Validator** is a polished one-shot checker: parses robots.txt
  (23 issue types), tests URLs against rules, audits 10 known AI-bot
  user-agents, validates sitemap XML (13 rules). All client-side except a
  47-LOC `fetch-url` proxy. **Stateless — no history, no client link, no
  monitoring.**
- Its sitemap/robots parsing is **independently reimplemented** from
  `lib/ada-audit/sitemap-crawler.ts` (same `Sitemap:` regex, separate `<loc>`
  extraction). Two parsers, zero sharing.
- **RankMath Redirects** is ~99% static documentation: two copy-paste
  WP-CLI/SQL workflows with a toggle. The dangerous part — Claude-generated
  SQL run against production WordPress databases — has **no validation,
  dry-run, or preview anywhere**.

## The big-picture view

These two tools are small on purpose, and shouldn't grow into monsters. But
each one is the seed of something the platform direction actually needs:

- The robots validator is a *monitoring check* trapped in a one-shot UI.
- The redirects guide is a *generator with safety rails* trapped in a doc.

## Recommendation

### Robots Validator → robots/sitemap monitoring (1–1.5 wks, after platform job queue)

1. **Consolidate parsing first (1–2 days):** one `lib/seo-fetch/` module
   (robots parse, sitemap parse/validate, sitemap-index recursion) consumed by
   the validator UI, the ADA sitemap crawler, and future scheduled checks.
   All network fetches in this module **must go through the existing
   `safeFetch` / SSRF guard** (`lib/security/safe-url.ts`) — the same
   protections the ADA crawler and `fetch-url` proxy already use; no new raw
   fetch paths. Ends the drift risk between the two implementations; surfaces
   the crawler's silent 1000-URL cap and browser-fallback in both UIs.
2. **Attach checks to clients:** "validate" against a client's domain stores
   a `RobotsCheck` snapshot (content hash, parsed result, issues) instead of
   evaporating on refresh.
3. **Schedule it:** a weekly job per client diffs robots.txt + sitemap
   against the previous snapshot and raises findings — *"robots.txt changed:
   GPTBot now blocked"*, *"sitemap lost 40% of its URLs"*, *"sitemap URLs
   returning 404"*. Build in noise controls from day one: compare by content
   hash so a byte-identical fetch raises nothing, alert only on
   state *changes* (not on every run that re-observes a known issue), and
   only check domains registered to a client (no monitoring of arbitrary
   URLs someone once pasted into the validator). A silently-broken robots.txt or sitemap is exactly the
   kind of regression that costs a client rankings for weeks before anyone
   notices; this is days of work on top of the job queue and the highest
   alert-value-per-effort in the whole roadmap.
4. Surface results on the client command center like every other finding.

### RankMath Redirects → redirect generator with a dry-run (1–1.5 wks, optional)

Two honest options; pick one deliberately:

- **Option A (recommended): build the generator.** Upload/paste a CSV of
  `source → target` pairs (or a Safe Redirect Manager export) → the tool
  generates the SQL/WP-CLI artifacts the guide currently asks Claude to
  write → with validation the manual flow can't give: loop detection, chain
  detection (A→B→C), duplicate sources, 302-vs-301 lint, RankMath
  serialization-format correctness, and a post-deploy **verification runner**
  that curls a sample of sources and confirms the 301 targets (the `safeFetch`
  infra already exists). The guide pages remain as the runbook around it.
- **Option B: keep it a doc.** If migrations are rare enough, explicitly
  declare this tool static, freeze it, and spend the week elsewhere. The
  wrong state is the current one: a documented manual process whose riskiest
  step (hand-run SQL on production) has no tooling support.

### What I would not do

- Don't give the webapp SSH/DB access to client WordPress servers to execute
  redirects directly — generation + verification yes, remote execution no.
  The blast radius is wrong for an internal tool.
- Don't expand AI-bot tracking into a general bot-management product;
  the known-bots list as a monitored finding is the right size.
- Don't persist anonymous one-shot validations (no client selected) — only
  client-attached checks deserve rows.

## Effort summary

| Item | Effort | Depends on |
|---|---|---|
| Shared robots/sitemap lib | 1–2 days | — |
| Client-attached checks + history | 2–3 days | — |
| Scheduled monitoring + alerts | 3–4 days | Platform job queue |
| Redirect generator + dry-run (Option A) | 1–1.5 wks | — |

Total ≈ 2–3 weeks for both tools fully done; the robots-monitoring path is
the part with platform-level payoff.
