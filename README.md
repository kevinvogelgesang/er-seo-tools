# ER SEO Tools

An internal SEO and web-accessibility toolkit built and maintained by **Enrollment Resources**. It gives the team one place to audit client and prospect websites, score their SEO and accessibility health, track changes over time, and produce client-ready reports.

> **Internal project.** This repository is a private, company-owned asset, not intended for public distribution. Company-authored code is proprietary to Enrollment Resources; third-party dependencies and assets remain under their own licenses. Access is limited to authorized team members.

## What it does

**Accessibility (ADA / WCAG) audits**
- Audit a single page or crawl a whole domain, auditing discovered pages up to a configured crawl limit.
- Full-render checks (real CSS, fonts, and layout) so rendering-dependent issues like color contrast are caught, not just raw markup problems.
- WCAG 2.1 AA by default, with an aspirational tier that adds WCAG 2.2 AA and best-practice checks.
- 0–100 accessibility score, prioritized findings, and site-wide pattern grouping.
- Automated findings surface likely issues to fix; they are not a certification of ADA/WCAG or legal compliance.

**SEO audits**
- Live crawl-based on-page SEO analysis, plus the ability to ingest Screaming Frog CSV exports for a deeper report.
- 0–100 SEO health score across indexability, errors, on-page elements, crawl depth, thin content, and structured data.
- Broken-link and on-page issue detection, content-quality signals, and keyword/topic analysis.
- **Crawl diff** — compare two scans of the same site to see what improved, regressed, or is newly broken.

**Reporting & client work**
- Branded, per-client SEO performance reports (PDF) that combine analytics, Search Console, and manually entered prospect data, with period-over-period comparisons.
- Prospect scans that produce a shareable, read-only report for sales conversations.
- Read-only shareable links for completed audits, with automatic expiry.

**Client & workflow tools**
- Client management with domain-based auto-matching so audits attach to the right account.
- Scheduled, recurring monitoring so sites are re-checked automatically.
- Utilities: robots.txt / sitemap validation with AI-bot coverage analysis, WordPress redirect-migration guidance, and a drag-and-drop quarterly planning grid.

## Tools at a glance

| Area | Route | What it's for |
|---|---|---|
| Audits | `/ada-audit` | Site-wide and single-page ADA/WCAG audits, SEO scans, and Screaming Frog CSV uploads, with unified recent-activity history |
| Prospect scans | `/sales` | Full audits of prospect (non-client) domains, shared as a public read-only report for meetings |
| Reports | `/reports` | Automated branded per-client SEO performance PDFs |
| Clients | `/clients` | Client records, domain matching, keyword profiles, and scheduled scans |
| Robots validator | `/robots-validator` | robots.txt + sitemap.xml validation and AI-bot coverage analysis |
| Redirect guide | `/rankmath-redirects` | WordPress redirect-migration helper |
| Quarter grid | `/quarter-grid` | Drag-and-drop quarterly client planning |
| Settings | `/settings` | Integration status and report scheduling |

## Getting started (team members)

New to the codebase? Start with the onboarding guide, which walks through local setup, how the app is structured, and how it runs:

- [`docs/onboarding/README.md`](docs/onboarding/README.md) — orientation and reading order
- [`docs/onboarding/02-local-setup.md`](docs/onboarding/02-local-setup.md) — getting a local environment running
- [`docs/onboarding/03-codebase-tour.md`](docs/onboarding/03-codebase-tour.md) — how the code is organized
- [`docs/onboarding/08-operations-runbook.md`](docs/onboarding/08-operations-runbook.md) — running and operating the app

Architecture notes, conventions, and the invariants that keep the app healthy live in [`CLAUDE.md`](CLAUDE.md) and in `docs/superpowers/`.

## Security & handling

- Treat this repository as **confidential**. Do not publish it, fork it outside the organization, or share access without authorization.
- **Do not commit secrets.** Configuration and credentials are supplied through environment variables and secret stores at deploy time. If you find a secret anywhere in the repo or its history, rotate it and report it.
- Deployment, server, and infrastructure details are maintained in internal operations documentation, not in this README.
- The app scans external websites on request; run it only against sites you are authorized to audit.

---

© Enrollment Resources. Company-authored code is proprietary and for internal use only; bundled third-party dependencies remain under their respective licenses.
