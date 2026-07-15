# 02 — Local Setup

Picking this back up after a gap? This doc assumes you've worked through
Units 1–2 of `docs/onboarding/01-fundamentals-path.md` (command line + git
basics, the PR workflow) but nothing past that — you don't need JavaScript or
TypeScript yet to get the app running. The outcome of this doc is narrow and
concrete: the app running on your own machine, one local accessibility audit
completed, and the test suite passing.

Everything below is a summary of `.claude/skills/er-seo-tools-build-and-env/SKILL.md`
— the authoritative, always-current source for setup and environment
mechanics in this repo. When something here and that skill disagree, the
skill wins; when a command fails in a way this doc doesn't explain, go read
the skill directly rather than guessing.

## 1. Prerequisites

Mac-first (a short Windows note is at the bottom).

| Requirement | Check | Notes |
|---|---|---|
| Node.js 22 or newer | `node --version` | `package.json`'s `engines` field requires `>=22`; production runs Node 22. If you don't have Node yet, install it via [nvm](https://github.com/nvm-sh/nvm) or the official installer at <https://nodejs.org>. |
| git | `git --version` | Comes preinstalled on most Macs; if not, `xcode-select --install` or install via [Homebrew](https://brew.sh). |
| Google Chrome | Installed as a normal Mac app | Only needed once you get to the ADA-audit step (Section 3) — the app drives a real Chrome install to run accessibility audits. |

You do **not** need Docker, Postgres, or any other external service. The
database is a single local SQLite file that lives inside your clone.

## 2. Setup walkthrough

### Clone and install

```bash
git clone <repo-url> er-seo-tools
cd er-seo-tools
npm install
```

`npm install` also runs a `postinstall` script that downloads and caches a
small (~25 MB) embedding model used by pillar analysis. That download is
tolerant of failure by design — if it's slow or you're offline, the install
still finishes and nothing else in the app breaks. If `npm install` looks
stuck for a while, this is almost always what's happening; it is not a hang.

### The `.env` file

Copy the tracked example file, then **edit it** — do not use it as-is:

```bash
cp .env.example .env
```

`.env.example` is written for a production server (`DATABASE_URL=file:/var/lib/...`,
etc.) — those paths don't exist on your laptop. Replace the contents of your
local `.env` with a minimal working set:

```bash
DATABASE_URL=file:./local-dev.db
UPLOADS_DIR=./local-uploads
PORT=3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`DATABASE_URL` is the only variable you strictly need for dev — everything
else in `.env.example` has a workable default or gates an optional feature
(see the table below). Leave `APP_AUTH_PASSWORD` **unset** — that's what
turns on the dev login bypass (more in Section 5).

- `DATABASE_URL` — where Prisma reads/writes the SQLite file. `file:./local-dev.db`
  resolves relative to the `prisma/` directory, so the real file ends up at
  `prisma/local-dev.db`. It's already gitignored.
- `UPLOADS_DIR` — where uploaded Screaming Frog CSVs are stored on disk.
- `PORT` — which port `npm run dev` listens on.
- `NEXT_PUBLIC_APP_URL` — the base URL the app uses to build share links and
  skill-handoff URLs (never trusts the request's own origin). Point it at
  your local dev URL.

Everything else in `.env.example` — Google OAuth, token-signing secrets, the
Lighthouse/PageSpeed provider, the Chromium egress-guard flags — is either
production-only or has a safe dev default. `.claude/skills/er-seo-tools-config-and-flags/SKILL.md`
is the full env-var catalog (every variable, its code default, and its
production value) — go there when you need to know what a variable not
covered here actually does.

### Database: generate the client and apply migrations

```bash
npx prisma migrate dev
```

This creates `prisma/local-dev.db`, applies every migration in
`prisma/migrations/`, and regenerates the Prisma client. Schema changes in
this repo always go through `npx prisma migrate dev --name <name>` — never
`npm run db:push` (that script exists but isn't the repo's convention).

### Run the dev server

```bash
npm run dev
```

This starts Next.js (with Turbopack) on the port from your `.env`. Open
<http://localhost:3000>. **You will not see a login screen.** With
`APP_AUTH_PASSWORD` unset and `NODE_ENV` not `production` — which is the dev
default — `lib/auth.ts`'s `isAuthBypassedInDev()` returns true, and
`middleware.ts` (the cookie gate that runs in front of every request) lets
every request through with no session at all. That's intentional: it's the
whole point of local dev being frictionless. It also means if you *do* see a
login wall in dev, something set `APP_AUTH_PASSWORD` — see the
troubleshooting table below.

### Run the test suite

```bash
DATABASE_URL="file:./local-dev.db" npm test
```

The inline `DATABASE_URL=` is not optional decoration — Vitest reads
environment variables from the shell, not from your `.env` file (the app,
the Prisma CLI, and Vitest each read env from a slightly different place —
this is the single biggest local-setup trap per the build-and-env skill), so
without it every database-backed test fails immediately. Most of this app's tests hit the real local SQLite
database directly (there's no separate test database), which is also why
you should not run test files in parallel — the suite is already configured
not to.

## 3. ADA audits, locally only

> **Safety rails — read before running any audit, anywhere in this guide:**
> - Run every exercise against your **local dev environment first.**
> - Scans and audits only ever target the **designated test-domain list.**
>   **Kevin fills in:** the designated test-domain list.
> - **No client scans without Kevin's explicit go-ahead** — ever.
> - **No production queue operations of any kind** before Stage 4 of
>   `05-milestones.md`.

The ADA audit tool drives a real, invisible ("headless") copy of Chrome to
load a page and run an accessibility-testing library (axe-core) against it.
That means, unlike most of this app, it needs an actual Chrome binary on
your machine, and the app needs to know where to find it.

The code's default Chrome path is `/usr/bin/google-chrome`, which is a Linux
path — it will not exist on your Mac. Set the macOS path explicitly in
`.env`:

```bash
CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

Restart `npm run dev` after adding this (env vars are read at process
start).

Now run one single-page audit as your first hands-on exercise:

1. With the dev server running, go to `/ada-audit` (the page component is
   `app/(app)/ada-audit/page.tsx`).
2. Enter a URL from the designated test-domain list above — a page you or
   Kevin control, or a page on `localhost` itself.
3. Start the audit and watch it run. It writes progress to the database as
   it goes, and the page polls and shows a live progress bar; when it
   finishes you'll see a scored list of accessibility violations.

That single completed audit — against a local or designated test target,
never a client site — is part of this doc's capability gate.

## 4. Troubleshooting

Every row below is a known failure mode from `.claude/skills/er-seo-tools-build-and-env/SKILL.md`.
Full detail on any of these: read that skill.

| Symptom | Cause | Fix |
|---|---|---|
| Tests fail with `Error code 14: Unable to open the database file` | `DATABASE_URL` isn't set in your shell and your root `.env` is missing or still points at a server path — Vitest never reads `.env.local` | Run tests with the inline form: `DATABASE_URL="file:./local-dev.db" npm test`, or put that value in root `.env` |
| A login wall appears in dev, unexpectedly | `APP_AUTH_PASSWORD` is set in your `.env` — the dev bypass requires it to be **unset** | Remove/unset `APP_AUTH_PASSWORD` in `.env` and restart `npm run dev` |
| `npx prisma migrate dev` targets, or fails on, an odd file path | The Prisma CLI reads your shell env and a root or `prisma/`-directory env file — never `.env.local` — and resolves relative `file:` paths against the `prisma/` directory, not the repo root | Put `DATABASE_URL=file:./local-dev.db` in root `.env` (not `.env.local`); the real file is `prisma/local-dev.db` |
| `npm install` seems to hang | `postinstall` is downloading the ~25 MB embedding model from HuggingFace; a slow/offline connection just delays it | Wait — the script is tolerant of failure and exits cleanly either way. If you need to skip it entirely: `npm install --ignore-scripts` |
| `next build` (or CI) is OOM-killed | Node's default type-check heap is too small for this codebase — this is a documented, previously-hit production incident, not a new problem | Don't touch it — `npm run build` already runs with `NODE_OPTIONS='--max-old-space-size=3072'` baked into the script in `package.json`; if you're still OOM'd, that's a signal to escalate, not to remove the flag |

## 5. Secrets and env safety

This section matters more than any command above it. Read it fully before
you touch a real credential.

**Never commit `.env`.** It's already listed in `.gitignore` (`.env`,
`.env*.local`, `.env.production` are all excluded) — you don't need to
remember to exclude it yourself, but you do need to never force-add it
(`git add -f`) or paste its contents somewhere that isn't gitignored.

**Recognize a secret when you see one**, so you don't paste it somewhere it
shouldn't go — into a doc, a Slack message, a Claude Code chat, a commit
message, or a screenshot. In this repo, secrets take a few recognizable
shapes:

- **API keys** — short opaque strings, e.g. `PAGESPEED_API_KEY`.
- **The auth cookie signing secret** — `APP_AUTH_SECRET`, a long random hex
  or base64 string generated with `openssl rand -hex 32` (see the comment
  above it in `.env.example`). If this leaks, someone can forge a valid
  login session.
- **A Google service-account JSON file** — the credential pointed to by
  `GOOGLE_SA_KEY_FILE`, used for the GA4/Search Console reporting feature.
  This is a whole JSON file, not a short string, and it's just as sensitive
  as a password.
- Anything else in `.env.example` with a comment like "REQUIRED in
  production" or "Generate with: `openssl rand ...`" — treat all of it as a
  secret, not just the ones named above.

If you're ever unsure whether something is a secret, treat it as one.

**Local env vs. production env are not the same file, and you will likely
never see the production one.** Your local `.env` is a file on your own
laptop, for local dev only. Production's real environment lives in two
places on the server, neither of which is your local `.env`:

1. `ecosystem.config.js` — tracked in this repo (so you can read its
   *shape* right now), read by PM2 on the server. It sets production tuning
   values (paths, concurrency, provider selection) — non-secret configuration.
2. A separate `.env` file at `$APP_HOME/.env` **on the
   server itself** — gitignored, holding the actual secrets (`APP_AUTH_SECRET`,
   OAuth credentials, token-signing secrets, `PAGESPEED_API_KEY`,
   `GOOGLE_SA_KEY_FILE`). You cannot see this file's values from the repo,
   and at your current stage you shouldn't need to — only Kevin has SSH
   access until Stage 4 of `05-milestones.md`.

So: the copy of `.env.example` in this repo tells you the **shape** of
production's configuration (what variables exist, what they're for) — it is
never the **live values**. Never assume a value you see anywhere in the repo
is what production is actually running.

**`DATABASE_URL` points at a different file in every environment.** Locally
it's whatever relative path you set in your own `.env` (`file:./local-dev.db`
in the walkthrough above, resolving to `prisma/local-dev.db`). In production,
`ecosystem.config.js` sets it to `file:${DATA_HOME}/db.sqlite`, which
resolves to `$DATA_HOME/db.sqlite` on the server (see
`CLAUDE.md`'s Deploy section). These are two entirely separate SQLite files —
nothing you do locally ever touches the production database.

**Where `lib/auth.ts` gets its secrets.** The signed auth cookie (`er_auth`)
is HMAC-signed with `APP_AUTH_SECRET`. In production that variable is
required — the app refuses to start without it (`requireAuthConfig()` in
`lib/auth.ts`). In dev, if it's unset, the code falls back first to
`APP_AUTH_PASSWORD`, then to a hardcoded dev-only constant — which is exactly
why setting `APP_AUTH_PASSWORD` in dev also turns the login wall on (Section
4's troubleshooting row). The break-glass password login itself is checked
against `APP_AUTH_PASSWORD`; Google OAuth login (the preferred production
path) is checked against `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`
plus the `GOOGLE_ALLOWED_HD` domain gate. None of these values are ever
something you type into a doc, a chat, or a commit — including this one.

## 6. Windows / WSL2 note

If your machine is Windows, develop inside **WSL2 (Ubuntu)**, not native
Windows. Install WSL2, then an Ubuntu distribution, then follow every step
above exactly as written, inside the WSL Ubuntu shell (a Linux environment,
so the Mac-specific `CHROME_EXECUTABLE` path in Section 3 doesn't apply —
you'll need Chrome/Chromium installed inside WSL and its own path there
instead). Native Windows paths, PM2, and SQLite's `file:` URL conventions
all behave differently enough from the Linux/macOS assumptions baked into
this repo that they will actively fight you — there is no supported native-Windows
path through this setup.

## 7. Capability gate

You're ready to move on to `01-fundamentals-path.md`'s remaining units (or
`05-milestones.md`'s Stage 0) when all of the following are true:

- `npm run dev` starts cleanly and you can load the app in a browser with no
  login screen.
- You have completed **one** ADA audit against a local or designated
  test-domain target (never a client site) and seen a real, scored result.
- `DATABASE_URL="file:./local-dev.db" npm test` runs and you can read its
  output (pass/fail counts) even if you don't yet understand every test.
- You can state, unprompted and without looking anything up: why `.env`
  is never committed, what a secret looks like in this repo (an API key, the
  auth cookie secret, a Google service-account JSON file), and why the
  `.env.example` in the repo is a shape, not a set of live values.
