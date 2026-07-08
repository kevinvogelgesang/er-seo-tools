# D7 — Scan-completion email notifications (design, ACTIVE)

**Status:** ACTIVE 2026-07-08 — design approved by Kevin, in Codex review, build
starting. **Provider: MAILGUN** (decided 2026-07-08 PM; Kevin initially said
Mailjet, corrected to Mailgun minutes later — Mailgun is authoritative). The
original Gmail-API/domain-wide-delegation plan was rejected by the Workspace
admin. Everything below EXCEPT §Transport survives the provider swap unchanged.
The transport account + verified sending domain are staged: `MAILGUN_API_KEY`
(domain-scoped sending key) + `MAILGUN_DOMAIN` are in the prod server `.env`
(staged 2026-07-08, chmod 600); nothing deployed reads them yet, so the feature
is dark-by-default until this ships.

## Decisions (all Kevin, 2026-07-07/08 — settled, do not re-litigate)

1. **Scope:** site audits only (all flavors — ADA, seoIntent, seoOnly).
   Standalone single-page ADA audits and report renders do NOT notify in v1.
2. **Recipient:** the requester — resolved SERVER-SIDE from the verified
   Google-OAuth session email. Client never supplies an address.
3. **Failures email Kevin, not the requester** (`NOTIFY_ADMIN_EMAIL`, default =
   sender) — only for audits that had notify requested; systemic failures stay
   with D0 health alerts.
4. **Timing:** email fires after the post-audit SEO analysis completes (end of
   `runBrokenLinkVerify` — runs for EVERY completed site audit; median ~36s
   after terminal) so the results page is fully populated. Verify-job
   `onExhausted` still sends the completion email.
5. **Opt-in per scan:** checkbox "Email me when this finishes" on BOTH manual
   entry forms — `SiteAuditForm` (ADA section) + `SeoScanForm` (SEO section);
   quick-site-audit widget only if it shares the form. **Always unchecked on
   page load** — no localStorage, no sticky default. Hidden when no session
   email exists (dev bypass / break-glass).
6. **Schedules stay silent** — the scheduled-site-audit wrapper never sets
   `notifyEmail`; per-schedule opt-in is a possible later increment.
7. **Sender identity:** `kevin@enrollmentresources.com` for now (replies come
   straight back to Kevin for QA); send-as alias / dedicated
   seo-tools@ mailbox later as this matures.

## Architecture (approved; ⊕ = Codex review fix, 2026-07-08)

- **Schema:** additive nullable `SiteAudit.notifyEmail String?`, stamped at
  creation when the checkbox is ticked. No AdaAudit column. **⊕ Plus two nullable
  durable sent-markers `notifyCompleteSentAt DateTime?` + `notifyFailedSentAt
  DateTime?`** — see the idempotency fix below.
- **API:** `POST /api/site-audit` accepts `notify: true`. **⊕ The route today
  reads only the unsigned operator-name cookie (`sanitizeOperatorName`), it does
  NOT call `getAuthSession` — verified.** So the change reads `AUTH_COOKIE_NAME`
  and calls `getAuthSession(cookie)` (`lib/auth.ts`, returns the verified
  identity incl. `.email`), and stamps `notifyEmail` ONLY when
  `raw.notify === true && session?.email`. Any client-supplied address field is
  ignored. **⊕ Thread `notifyEmail` through `QueueRequestInput` →
  `queueSiteAuditRequest` → `EnqueueAuditOptions` → `enqueueAudit` →
  `SiteAudit.create`** (it is not a column the current create path sets).
- **⊕ Idempotency — the real guard is durable sent-markers, NOT dedupKey.** Job
  `dedupKey` is **active-window only** (`jobs_active_dedup` partial unique index
  `WHERE status IN ('queued','running')` — verified in `lib/jobs/queue.ts`), so a
  *completed* `notify-email` job does NOT stop a later recovery replay from
  enqueuing a twin. The send-time guard is therefore: the handler sets
  `SiteAudit.notify{Complete,Failed}SentAt` in the SAME array-form transaction
  that it treats as "sent", and no-ops if the relevant marker is already non-null
  (conditional `updateMany` fenced on the marker being null → "first sender
  wins"). `dedupKey notify:<siteAuditId>:<kind>` stays as a *cheap in-flight*
  dedup, not the correctness guarantee.
- **Trigger seams:** (a) end of `runBrokenLinkVerify` (complete kind) +
  its `onExhausted` (**⊕ which may run with NO live-scan run** — see content);
  (b) `failSiteAudit` (failed kind → admin) — **⊕ enqueued ONLY after the parent
  flip succeeds (`flipped === 1`, the `updateMany({status:{notIn:[terminal]}})`
  affected one row), so multiple recovery passes don't each notify.** All hooks
  are wrapped so a notify failure can NEVER touch the audit/builder (findings-hook
  rule). **⊕ At the `runBrokenLinkVerify` seam the enqueue is `await`ed inside a
  try/catch that logs-and-swallows** (not bare `void …().catch()`), so the verify
  job doesn't settle `complete` before the notify-job insert is at least
  attempted — the catch still guarantees a notify failure never fails the builder.
- **⊕ Notify job group key:** the `notify-email` job MUST NOT use
  `groupKey: site-audit:<id>` (that group means "audit alive" to recovery, and
  `failSiteAudit` calls `cancelJobsByGroup(site-audit:<id>)` — a notify job in it
  would be cancelled before it sends). Use no group key, or `notify:<id>`.
- **Durable `notify-email` job:** concurrency 1, 3 attempts + backoff,
  dedupKey `notify:<siteAuditId>:<kind>`. Payload `{siteAuditId, kind:
  'complete'|'failed'}`; recipient + content resolved at send time from the row.
  **⊕ No-op (return, don't throw — a throw burns a retry) when: the SiteAudit row
  is deleted; `notifyEmail` is null (failed-kind: `NOTIFY_ADMIN_EMAIL` unset too);
  the relevant sent-marker is already set; or required Mailgun env is missing
  (dark).** Missing-env is a clean no-op, NOT an infinite retry.
- **Transport module `lib/notify/`** — injectable deps (`realDeps` pattern
  mirrored from `lib/ada-audit/broken-link-check.ts`) so ALL tests run mocked.
  **⊕ Specify a request timeout (AbortController, like the verify checker) and
  sanitized error logging: a Mailgun non-2xx body is truncated and logged, and
  MUST never include `MAILGUN_API_KEY`.** This isolation is what makes the
  provider swap cheap.
- **Dark by default** (D0 `ALERT_WEBHOOK_URL` pattern): `MAILGUN_API_KEY` or
  `MAILGUN_DOMAIN` unset → checkbox hidden, hooks no-op. Deployable before/without
  the account. NOT added to `instrumentation.ts` fail-fast gates.
- **⊕ UI session-email gating:** there is no existing `/api/auth/session`
  endpoint. The checkbox visibility is driven by a **server-derived prop** passed
  from the (server-component) page into the form — the page already runs
  server-side and can read the auth cookie / whether a session email exists — so
  no new endpoint is required. Server-side stamping is the real gate regardless;
  the UI just hides the checkbox when it cannot know an email exists.
- **⊕ Schedules AND bulk-queue stay silent:** both `scheduled-site-audit` and the
  bulk-queue caller go through `queueSiteAuditRequest`; `notifyEmail` defaults
  `null` and neither passes it. Tests assert both remain silent.
- **Content:** complete → subject `Site audit finished — <domain> (ADA <x> ·
  SEO <y>)`; body = requester name, domain, scan type, scores, duration, deep
  link via `NEXT_PUBLIC_APP_URL` (never request origin). **⊕ The `onExhausted`
  ('complete') path must tolerate a missing live-scan run / null SEO score** — it
  states the site audit finished and links to results, and either omits SEO or
  notes "SEO analysis unavailable" rather than rendering a literal 0. Failed → to
  admin: domain, requester, terminal error, link. Plain HTML + text, no template
  engine.
- **⊕ From / Reply-To:** `From = NOTIFY_FROM` (default
  `kevin@enrollmentresources.com`, decision 7). Add `NOTIFY_REPLY_TO` (default =
  Kevin's address) so Kevin can flip `NOTIFY_FROM` to an aligned
  `@enrollment.email` sender (fixing DMARC alignment — see §Transport) while
  replies still land in his inbox.
- **Testing:** mocked transport throughout — handler (happy/retry/**⊕ deleted-row
  no-op / null-email no-op / already-sent no-op / missing-env no-op** / admin
  routing), API (server-side stamping from session, ignores client email,
  null-when-no-session), **⊕ schedules + bulk-queue stay silent**, forms
  (unchecked after reload, posts `notify: true`, hidden when no session email).
  Real-send smoke = post-deploy prod verify. Array-form `$transaction([...])`
  only.

## Transport (MAILGUN — verified against the staged prod account 2026-07-08)

~~Gmail API via existing service account + domain-wide delegation~~ —
**REJECTED by Workspace admin 2026-07-08** (he prefers SendGrid or Mailjet).
Historical detail if ever revisited: SA `er-seo-reports@seo-apps-485618`,
client ID `112324513447926498495`, Gmail API already enabled on project
`seo-apps-485618`; DWD grant was never made.

**MAILGUN (decided 2026-07-08 PM, Kevin — corrected from an initial "Mailjet"
slip):** Messages API `POST https://api.mailgun.net/v3/<MAILGUN_DOMAIN>/messages`
(Basic auth `api:<key>`, form-encoded) — plain HTTP POST from the job handler,
no SDK/SMTP lib. Env: `MAILGUN_API_KEY` (a domain-scoped **sending key**, not
the account-wide private key) + `MAILGUN_DOMAIN`; the dark-by-default gate =
"either unset". US region (`api.mailgun.net`); a `MAILGUN_API_BASE` env override
covers an EU account (`api.eu.mailgun.net`) without a code change.

**Verified DNS reality (dig, 2026-07-08 — supersedes the earlier
`mg.enrollmentresources.com` assumption):** the staged account's `MAILGUN_DOMAIN`
is **`mg.enrollment.email`** — a subdomain of a *separate* org domain
(`enrollment.email`), NOT of `enrollmentresources.com`. That sending domain is
fully configured and verifiable:
- SPF ✓ — `mg.enrollment.email` TXT = `v=spf1 include:mailgun.org ~all`
- DKIM ✓ — published at selector **`pic._domainkey.mg.enrollment.email`** (RSA);
  the spec's earlier `smtp._domainkey` guess is wrong for this account
- Mailgun MX ✓ (`mxa/mxb.mailgun.org`) + tracking CNAME `email.mg.enrollment.email`
  → `mailgun.org` ✓

**Sender identity — DMARC-alignment caveat (deviates from decision 7's
assumption, NOT from the decision itself).** Decision 7 keeps From =
`kevin@enrollmentresources.com`. Because the sending domain is `enrollment.email`
(not `*.enrollmentresources.com`), Mailgun's DKIM signs `d=mg.enrollment.email`
and the envelope/return-path is on `enrollment.email` — so **neither SPF nor
DKIM aligns with the From org domain `enrollmentresources.com`**, and DMARC for
that domain is *unaligned* (fails). `enrollmentresources.com` DMARC is `p=none`
(dig-verified) so nothing hard-rejects, and delivery to Kevin's own inbox
(same org, internal) is expected to work for the QA smoke; but Gmail may show a
"via mg.enrollment.email" tag and external deliverability could suffer over time.
**Mitigation (in scope):** the From address is env-overridable via `NOTIFY_FROM`
(default = decision 7's `kevin@enrollmentresources.com`). Post-smoke, if delivery
is poor, Kevin can set `NOTIFY_FROM` to an aligned `@enrollment.email` /
`@mg.enrollment.email` address (which DKIM-aligns relaxed → DMARC pass) with a
PM2 restart, no redeploy. This is a config escape hatch, not a re-litigation of
decision 7.
**Sandbox caveat:** Mailgun's sandbox domain delivers ONLY to pre-authorized
recipients — irrelevant here since a real verified domain is staged.

## Open items on resume

1. ~~Mailgun account + verified sending domain + sending API key.~~ **DONE** —
   `mg.enrollment.email` staged + DNS-verified, `MAILGUN_API_KEY`/`MAILGUN_DOMAIN`
   in the prod `.env` (2026-07-08).
2. Codex review of this spec (in progress), plan, build. Rebase caution: the two
   form files (`SiteAuditForm`, `SeoScanForm`) are under active A8/C11
   development — branch fresh off `origin/main`.
3. Post-smoke deliverability watch: if Gmail spam-folders or flags the
   cross-domain From, flip `NOTIFY_FROM` to an `@enrollment.email` sender (Kevin,
   env only).
