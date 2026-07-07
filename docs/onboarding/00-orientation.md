# 00 — Orientation

If you're picking this back up after time away: this is the very first doc in
the `docs/onboarding/` guide. It orients you before any code — what this app
is, what its tools are called in SEO terms you already know, and how work
gets done on this repo. Nothing here requires you to have written a line of
JavaScript yet.

## What er-seo-tools is

er-seo-tools is an internal toolkit built and run by Kevin for Enrollment
Resources' SEO work. It does the things you already do manually — crawling a
site, running an accessibility audit, digging through a Screaming Frog
export, building a client report — except as a web app that a browser talks
to instead of a spreadsheet or a desktop tool. You already know *what* these
jobs are; this guide is about learning *how the app does them* and,
eventually, owning that "how" yourself: new features, database changes,
deployments, keeping it running in production.

That last part is the point of the whole guide. You are not just going to
use this tool — you are going to grow into the person who builds and runs
it. Kevin currently reviews every change and runs every deploy. As you work
through the stages in `05-milestones.md`, more and more of that
responsibility becomes yours, gate by gate, at whatever pace real life
allows.

## The tools

This app is organized as a set of pages, each one a self-contained tool. The
list below is a snapshot in your own words — the "Tools in the app" table in
`CLAUDE.md` is the version that's always current, so when a new tool gets
added, that table (not this doc) is where it shows up first.

**`/seo-parser`.** This is the one you'll recognize fastest: you upload the
CSVs that Screaming Frog exports after a crawl, and the app turns them into a
prioritized SEO report with a health score — the same kind of analysis you'd
otherwise build by hand in a spreadsheet from that export. In dev terms:
it's a page that accepts file uploads, runs them through a set of parsers,
and stores the results in the database so you can come back to them later.

**`/ada-audit`.** This runs a WCAG accessibility audit — either one page or
an entire site — the way you'd otherwise run axe DevTools or a similar
checker by hand, page by page. Here it's automated: a headless (invisible)
copy of Chrome loads each page and an accessibility-testing library called
axe-core checks it against WCAG rules, then scores the results. In dev terms:
it's a page that starts a job running in the background, and a second page
that checks back on it repeatedly and displays the findings once they're
ready.

**`/robots-validator`.** This checks a site's `robots.txt` and `sitemap.xml`
for the kinds of mistakes that quietly block crawlers — the manual check you
already know how to eyeball, done for you. In dev terms: it's a page that
fetches those two files over HTTP and runs a set of validation rules against
their contents.

**`/quarter-grid`.** A drag-and-drop board for planning what SEO work
happens across roughly thirty clients over a quarter — the same kind of
planning you might otherwise track in a spreadsheet or a project board. In
dev terms: it's an interactive drag-and-drop page that can push planned
weeks of work into Teamwork (the team's project-management tool).

**`/rankmath-redirects`.** A guide for migrating WordPress redirects when a
client's site changes URL structure — the kind of reference sheet you'd
otherwise keep in a doc. In dev terms: it's mostly a static content page.

**`/clients`.** The list of clients this toolkit tracks, each matched to
their domain so a scan of a site can be connected to the right client
automatically — your client roster, wired into the rest of the app so every
other tool knows which client it's working on. In dev terms: it's a set of
pages for creating, editing, and looking up client records in the database.

**`/reports`.** Automated, branded, per-client SEO performance PDFs pulling
from Google Analytics 4, Search Console, and the CRM's Prospects data,
compared period-over-period — the recurring client report you'd otherwise
assemble by hand every month. It runs on demand or on a monthly schedule. In
dev terms: it's a page that triggers a background job which fetches data
from those external APIs, turns the data into an HTML report, and saves
that report as a PDF.

**`/settings`.** Where you can see whether the app's connection to Google's
reporting APIs is working (the credential that lets `/reports` pull GA4 and
Search Console data automatically, without a person logging in each time)
and control the monthly report schedule — the app's own control panel for
the plumbing behind `/reports`. In dev terms: it's a page for viewing and
editing a small set of configuration values.

## Vocabulary: SEO terms you know → what they're called here

You already have working definitions for most of the concepts this app is
built around. The table below maps the term you'd use talking about SEO work
to the name the *app* (and this guide, and the code) uses for the same idea,
plus where you'll meet it properly — you don't need to understand the "where"
column yet, just know it's coming.

| SEO term you know | Term in this app | Where you'll meet it |
|---|---|---|
| A crawl | `CrawlRun` | `03-codebase-tour.md` (data model) |
| A page inside a crawl | `CrawlPage` | `03-codebase-tour.md` |
| An issue/finding from an audit | `Finding` | `03-codebase-tour.md` |
| An accessibility violation | `Violation` | `03-codebase-tour.md` |
| A Screaming Frog export you uploaded | A parser *Session* | `03-codebase-tour.md` |
| A full-site accessibility scan | `SiteAudit` | `03-codebase-tour.md` |
| A single-page accessibility scan | `AdaAudit` | `03-codebase-tour.md` |
| A PageSpeed / Core Web Vitals check | A *PSI* (PageSpeed Insights) / *Lighthouse* job | `04-how-it-runs.md` |
| A scan you want to run automatically and repeatedly | A `Schedule` | `04-how-it-runs.md` |

Two docs down the line (`01-fundamentals-path.md` and `03-codebase-tour.md`)
will point back here rather than re-explain these terms — this table is the
one place they live, so when you forget one, come back to this section.

## How work happens on this repo

Code changes go through git and GitHub, the same version-control ideas as
any other software project — if that's new to you, `01-fundamentals-path.md`
starts there. At first, Kevin reviews every pull request (a proposed change,
waiting for review before it's merged in) and runs every deploy (the step
that puts a change live). As you move through the stages in
`05-milestones.md`, you take on more of both.

Bigger changes are planned before they're built. Design docs — specs (what
we're building and why) and plans (the concrete steps) — live in
`docs/superpowers/`. A spec becomes a plan, the plan gets implemented, and
once the work has shipped, both documents move into an `archive/`
subfolder — so `docs/superpowers/` doubles as a history of *why* the app is
shaped the way it is, not just a to-do list.

Claude Code — an AI coding assistant — is the daily development tool on this
project, for Kevin and for you. That's covered properly in
`06-working-with-ai.md`; for now, just know that AI-assisted
development is a first-class, expected part of how this repo gets built, not
a shortcut around learning the codebase.

The single most information-dense file in the whole repo is `CLAUDE.md`, in
the project root. It's the living contract for how this codebase is built:
stack rules, architecture patterns, a running inventory of key files, and a
list of things never to do. You will read it many, many times — treat it as
the first place to check whenever you're unsure how something is supposed to
work here, and as the place that gets corrected when code and documentation
disagree.

## How to use this guide

The numbered docs in `docs/onboarding/` serve two different reading modes,
laid out in `docs/onboarding/README.md`. Some are a *path* — read in order,
each one building on the last (this doc, then `01-fundamentals-path.md`,
`02-local-setup.md`, `05-milestones.md`, `06-working-with-ai.md`). Others are
a *reference* you skim once and return to deliberately whenever a task needs
that map (`03-codebase-tour.md`, `04-how-it-runs.md`, and — if you're ever
asked to work with an outside senior developer — `07-senior-brief.md` and
`08-operations-runbook.md`).

Progress through the path is measured in capability gates, never time. There
is no "finish this by Friday" anywhere in this guide, by design — each stage
in `05-milestones.md` defines "you're ready to move on when you can…" instead
of a pacing estimate. It's completely fine to sit at one stage for a long
stretch; every doc in this set opens with enough re-orientation that picking
it back up after a gap costs you a re-read, not a restart.

If you only remember one pointer from this whole doc, make it this one:
`05-milestones.md` is the spine of the entire path. Whenever
you're not sure what to work on next, that's where the answer lives.
