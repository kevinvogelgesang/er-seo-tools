# D7 — Scan-completion email notifications (design, SHELVED)

**Status:** SHELVED 2026-07-08 — design approved by Kevin, NOT Codex-reviewed,
NOT built. **Blocker:** transport. The original Gmail-API/domain-wide-delegation
plan was rejected by the Workspace admin, who wants **SendGrid or Mailjet**
instead; no account exists yet. Everything below EXCEPT §Transport survives the
provider swap unchanged. Resume by: getting the SendGrid/Mailjet account +
API key, updating §Transport, then Codex review → plan → build per the ritual.

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

## Architecture (approved)

- **Schema:** additive nullable `SiteAudit.notifyEmail String?`, stamped at
  creation when the checkbox is ticked. No AdaAudit column.
- **API:** `POST /api/site-audit` accepts `notify: true`; server resolves the
  session email via `getAuthSession` and stamps it. Ignores any client-supplied
  address.
- **Trigger seams:** (a) end of `runBrokenLinkVerify` (complete kind) +
  its `onExhausted`; (b) `failSiteAudit` (failed kind → admin) when
  `notifyEmail != null`. All hooks `void …().catch(log)` — a notify failure can
  NEVER touch the audit/builder (findings-hook rule).
- **Durable `notify-email` job:** concurrency 1, 3 attempts + backoff,
  dedupKey `notify:<siteAuditId>:<kind>` (recovery replay can't double-send).
  Payload `{siteAuditId, kind: 'complete'|'failed'}`; recipient + content
  resolved at send time from the row.
- **Transport module `lib/notify/`** — injectable deps (`realDeps` pattern like
  the verify job) so ALL tests run mocked. This isolation is what makes the
  provider swap cheap.
- **Dark by default** (D0 `ALERT_WEBHOOK_URL` pattern): required env unset →
  checkbox hidden, hooks no-op. Deployable before the account exists.
- **Content:** complete → subject `Site audit finished — <domain> (ADA <x> ·
  SEO <y>)`; body = requester name, domain, scan type, scores, duration, deep
  link via `NEXT_PUBLIC_APP_URL` (never request origin). Failed → to admin:
  domain, requester, terminal error, link. Plain HTML + text, no template
  engine.
- **Testing:** mocked transport throughout — handler (happy/retry/null-email
  no-op/admin routing), API (server-side stamping), forms (unchecked after
  reload, posts `notify: true`). Real-send smoke = post-deploy prod verify.

## Transport (THE OPEN SECTION — rewrite when the account exists)

~~Gmail API via existing service account + domain-wide delegation~~ —
**REJECTED by Workspace admin 2026-07-08** (he prefers SendGrid or Mailjet).
Historical detail if ever revisited: SA `er-seo-reports@seo-apps-485618`,
client ID `112324513447926498495`, Gmail API already enabled on project
`seo-apps-485618`; DWD grant was never made.

**SendGrid/Mailjet shape (either):** HTTP API + API-key env var (e.g.
`SENDGRID_API_KEY` / Mailjet key+secret) — the dark-by-default gate becomes
"key unset". One-time provider setup: **domain authentication for
enrollmentresources.com (SPF/DKIM DNS records)** so mail can be sent as
`kevin@enrollmentresources.com` without spoofing flags — or single-sender
verification of kevin@ as the minimal start. Prefer the plain HTTP API over an
SMTP client lib (no new heavy dependency; `safeFetch`-style POST from the job
handler). Everything else in this doc is transport-agnostic.

## Open items on resume

1. Which provider (SendGrid vs Mailjet) + account/API key from the admin.
2. Domain authentication (DNS) vs single-sender verification — affects whether
   From can be kevin@ cleanly.
3. Then: Codex review of this spec (never done), plan, build. Rebase caution:
   the two form files are under active A8/C11 development.
