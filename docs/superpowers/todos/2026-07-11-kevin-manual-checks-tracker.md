# Kevin's manual checks — outstanding authed-UI verification + setup steps

**Created:** 2026-07-11 · **Owner:** Kevin · **Maintained by:** roadmap sessions

Everything here needs a human with an authed browser session (prod is OAuth-only)
or access sessions can't have (server `.env`, reference docs). Nothing on this
list blocks other roadmap work. Tick items `[x]` as you complete them and tell
the session — it will move them to the Completed log at the bottom with the date
and any observations worth recording.

Prod: https://tools.enrollmentresources.com (paths below are relative).

---

## 1. Setup / decision steps (KS-5 aftermath)

- [ ] **1.1 KS-5 end-to-end workflow run** — the big one. On a client that has
  GSC mapped + a live-scan run + a confirmed program roster + locale set:
  `/clients/[id]` → **Keyword Strategy** card → *Generate strategy prompt* →
  paste the clipboard payload into a fresh chat (the `er-handoff-memo` skill
  triggers on the `kst_` token) → verify the 8-section strategy doc posts back
  to the card. Also worth eyeballing: the *Regenerate* path (old memo should
  survive on the card until the new doc writes back).
- [ ] **1.2 Provide the 4 reference docs** for the er-handoff-memo skill →
  `~/.claude/skills/er-handoff-memo/references/`:
  program categories · BOFU patterns · intent definitions · compliance
  exclusions. Until these exist, the template falls back to its When-to-Ask
  questions mid-generation.
- [ ] **1.3 (Optional) Light up the volume endpoint** — set `DATAFORSEO_LOGIN`
  + `DATAFORSEO_PASSWORD` in the prod `.env` (Kevin-only file), then restart
  the app. Until then `POST /api/keyword-strategy/[id]/volumes` returns an
  honest 409 `volume_disabled`. Caps shipped: 1,500 kw/session ·
  25,000 kw/month.
- [ ] **1.4 (Passive) Confirm or override the KS-5 §5 defaults** — shipped as
  proposed: 1,500/25,000 caps · `kst_` prefix · refresh-GSC-on-mint · hedged
  FAQ phrasing ("no FAQ detected — verify"). Nothing to do unless you want one
  changed; say so and a session will adjust.

## 2. New keyword-strategy UI (C20 / KS-1..5)

- [ ] **2.1 KeywordProfileCard suggest (KS-3)** — `/clients/[id]` → Keyword
  Profile card: set institution type + locale, save a program roster, hit
  *Suggest programs* (needs a live-scan run for entity-based suggestions;
  older clients degrade to slug/heading suggestions), confirm/dismiss a few.
- [ ] **2.2 GscKeywordCard refresh (KS-1)** — `/clients/[id]` on a GSC-mapped
  client → GSC Keywords card → refresh snapshot; check the wins / opportunities
  / quick-wins / cannibalization lists look sane.

## 3. Audits-surface reworks (C15–C18)

- [ ] **3.1 C15 Mine filter** — `/ada-audit` unified recents: All/Mine toggle,
  search, client filter, session delete.
- [ ] **3.2 C16 merged Audits page** — `/ada-audit`: Scan Type selector (site
  ADA / site SEO / single page), SF CSV upload collapsed under Scan Type = SEO,
  recents badges (Site ADA · Site SEO · Single Page · SF Upload), and
  `/seo-audits` 308-redirecting here with old results/share URLs still working.
- [ ] **3.3 C17 seoOnly auto-flip** — run a Scan Type = SEO site audit end to
  end: while transient the site page shows the poller; on completion it should
  redirect to the live-scan run results page (or show the "SEO phase" banner
  while the verifier finishes).
- [ ] **3.4 C18 results tabs** — a complete full site audit: shared header
  (ADA + SEO score rings, export bar, diff panel) + **Accessibility | SEO**
  tabs with `?resultTab=` URL sync; the public share page renders the same
  shell (no screenshots/element dropdowns in share mode).

## 4. Prospect sales view (C14)

- [ ] **4.1 `/sales` intake** — create a prospect, watch the scan run from the
  dashboard (8s polling), share-link generation.
- [ ] **4.2 Real `/sales/[token]` report** — open the public token URL in a
  logged-out/incognito window: hero tiles, Accessibility/SEO/Performance/GEO
  sections, pattern screenshots load, "being prepared" page if the audit is
  still running.

## 5. Scoring surfaces (C19 / A8)

- [ ] **5.1 Re-scan Bellus** — expect score **≈ 68** with the v4 badge; check
  the score-version badge + invoice line render.
- [ ] **5.2 `/settings` scoring cards + `/score-lab` (post-C19)** — SEO + ADA
  weight cards on `/settings`; `/score-lab` what-if sandbox.
- [ ] **5.3 `/clients` fleet + client dashboard (post-A8-PR7)** — fleet view
  and per-client dashboard render; **observe only:** on the first real
  `ScoringWeights` save, sparkline deltas across the weightsHash change should
  be suppressed rather than showing a fake jump.

## 6. C12 content-audit SEO-tab (Tier-1 C + Increment D1)

- [ ] **6.1 TopicOverlapSection eyeball (Tier-1 C)** — on a fresh live-scan
  SEO-tab result for a site with related/competing pages: `/ada-audit/site/[id]`
  → SEO tab → *Topic overlap* section shows "topic-overlap networks" (or an
  honest "no overlap detected" when clean, vs "not analyzed" when the run has
  no data).
- [ ] **6.2 ContentAuditCard mint + prompt (D1)** — same SEO tab → *Content
  audit* card (only appears once the live-scan run exists): click *Start content
  audit* → a `cat_` clipboard prompt appears with a Copy button; the `Webapp:`
  line should be the prod dashboard URL (not a literal). If the retained text
  already expired (>~2h after the scan), the card shows the honest
  "text expired — will fetch live" note.
- [ ] **6.3 cat_ end-to-end handoff run (D1)** — paste that prompt into a fresh
  chat (the `er-handoff-memo` skill triggers on the `cat_` token / `Content
  Audit ID:` line) → it fetches the manifest, reviews pages, and PATCHes
  findings back → the card's poll surfaces the findings (grouped by type) without
  a reload. Confirms the whole bridge + the v2.3.0 skill routing.

---

## Completed log

(Sessions: when Kevin reports an item done, tick it above and append a dated
line here — newest first — with anything observed worth keeping.)

- *(nothing yet)*
