# er-seo-tools Onboarding & Ownership Guide

This folder takes a new developer from zero — no JavaScript/TypeScript/Node experience, but strong SEO domain knowledge — to owning er-seo-tools: features, schema migrations, deploys, and production operations. It also contains a standalone brief for an experienced outside developer advising or reviewing the project without prior context on this repo.

## Two entry points

- **Junior developer:** start at `docs/onboarding/00-orientation.md` and go in order.
- **Senior developer advising or reviewing:** read `docs/onboarding/07-senior-brief.md`, then skim `docs/onboarding/03-codebase-tour.md` and `docs/onboarding/04-how-it-runs.md` (follow the *Senior: read now* labels).

## The doc set

| File | What it is |
|---|---|
| `docs/onboarding/00-orientation.md` | What this app is, in SEO language first — tools, vocabulary, how work happens here |
| `docs/onboarding/01-fundamentals-path.md` | The ordered external curriculum (JS → TS → Node → HTTP → React → Next.js → SQL) with repo anchors |
| `docs/onboarding/02-local-setup.md` | Get it running on your machine, plus secrets/env safety rules |
| `docs/onboarding/03-codebase-tour.md` | Reference map of the repo: layout, request flow, layers, data model, UI conventions |
| `docs/onboarding/04-how-it-runs.md` | Reference for the machinery: job queue, audit lifecycle, recovery, retention, prod topology |
| `docs/onboarding/05-milestones.md` | The staged path to ownership — Stage 0 (run it) through Stage 4 (operate prod), with capability gates |
| `docs/onboarding/06-working-with-ai.md` | The house AI-assisted workflow: Claude Code, skills, specs/plans, Codex review, the trust model |
| `docs/onboarding/07-senior-brief.md` | For the outside senior: the big decisions, their real rationale, known debt, how to supervise |
| `docs/onboarding/08-operations-runbook.md` | Running production: deploy, logs, health, common diagnoses, retention, backups |

## How to use this guide

The numbered docs (`00`–`08`) serve two reading modes:

- **Path reading:** `00`, `01`, `02`, `05`, and `06` are the junior's ordered path — read them in sequence, working through the fundamentals curriculum and setup steps as you go.
- **Reference reading:** `03`, `04`, `07`, and `08` are standalone references. Return to them as needed rather than reading once and moving on — `03` and `04` in particular are meant to be skimmed early and re-read deeply later.

Progress is measured by **capability gates, not deadlines** — each stage in `05-milestones.md` defines "you're ready to move on when you can…" instead of a pacing estimate. It's fine to be at a stage a long time; the guide is built to be resumed after gaps, and each doc opens with enough re-orientation to pick back up.

## Maintenance

These docs are versioned with the code: if a PR changes architecture described here, the same PR updates the doc. Run `bash scripts/check-onboarding-docs.sh` and confirm it passes before committing any changes to `docs/onboarding/`.
