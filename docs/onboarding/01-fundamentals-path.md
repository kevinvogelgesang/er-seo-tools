# 01 — The Fundamentals Path

Picking this back up after a gap? This doc assumes you've read
`docs/onboarding/00-orientation.md` — what er-seo-tools is, the vocabulary
table, and how work happens here — but nothing else. It's the ordered,
outside-in curriculum that gets you from zero JavaScript/TypeScript/Node to
being able to read (and eventually write) the code in this repo. It curates
external resources; it does not reteach them from scratch.

## How to study this path

Work through the nine units below **in order** — each one leans on ideas from
the one before it. Every unit ends with a **capability check**: a concrete
"you're done when you can…" that Kevin can verify by talking with you or by
looking at something you produced. There is no pacing target anywhere in this
doc — progress is measured by what you can do, not by any schedule.

You do **not** need to finish this whole path before touching the app. It is
explicitly fine — expected, even — to **interleave these units with Stage 0
("Run it") and Stage 1 ("Read it") of `05-milestones.md`**. Getting the dev
server running and clicking through the tools with fresh JavaScript concepts
in your head reinforces both. If a stage exercise in `05-milestones.md` sends
you back here for a specific unit, that's the path working as intended.

Each unit has four parts: **why it matters here**, the **curated
resource(s)**, a **repo anchor** (open a real file in this codebase and find
the thing you just read about), and the **capability check**.

---

## Unit 1 — Command line + git basics

**Why you need this.** Everything else in this guide assumes you can get
around a terminal and move code in and out of git — there is no GUI-only path
through this repo. You'll run `npm` scripts, start the dev server, and commit
changes from the command line for the rest of your time on this project.

**Resource.** MDN's command line primer:
<https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Environment_setup/Command_line>.
For git itself, the "Git Basics" chapter of the free Pro Git book:
<https://git-scm.com/book/en/v2/Getting-Started-Git-Basics>. You want:
navigating directories (`cd`, `ls`), running a project script, and
`clone`/`status`/`add`/`commit`/`log`.

**Repo anchor.** Clone this repo if you haven't already, then run:

```bash
git log --oneline -20
```

Read the last 20 commit messages. Notice the style: a short prefix
(`docs:`, `feat:`, `fix:`) followed by a terse, present-tense summary. That's
not a convention this guide invented — it's what's actually in `git log`
right now, and it's what your own commit messages should look like.

**Capability check.** You can clone this repo fresh, run `git log --oneline`
and explain what three of the last 20 commits changed just from their
messages, and you can describe the difference between `git status` and
`git log` in your own words.

---

## Unit 2 — Practical git/PR workflow

**Why you need this.** Cloning and committing gets you *into* git; this unit
is how you actually ship a change on this project — branches, pull requests
(PRs), and Kevin's review. Every change to this repo, including this doc set,
goes through this exact workflow.

**Resource.** GitHub's own docs on the PR lifecycle: "About pull requests"
<https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests>
and "Resolving a merge conflict on GitHub"
<https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/addressing-merge-conflicts/resolving-a-merge-conflict-on-github>
for the conflict-resolution basics.

Beyond reading a PR description, you'll need to *write* one, respond to
review comments, stage individual hunks (not just whole files), and read a
`git diff` before you ask anyone to look at it. Practice `git diff`,
`git add -p`, and `git log --stat` locally — these are core daily-driver
skills here, not just PR mechanics.

**Repo anchor.** Browse this repo's own merged pull requests on GitHub
(`github.com/kevinvogelgesang/er-seo-tools/pulls?q=is%3Apr+is%3Amerged`) and
read a few descriptions. Then look at the branch names behind recent merges
in your local history:

```bash
git log --oneline --all -30
```

You'll see names like `feat/app-shell-pr1`, `feat/widgets`, `fix/shell`,
`docs/onboarding` — a short type prefix plus a slash plus a short slug. That's
the branch-naming convention on this repo; match it when you open your own
branches.

**Capability check.** Before you ask Kevin for a review on *any* PR, you can
run through this self-checklist and answer honestly: did I read my own diff
end-to-end (`git diff main...HEAD`)? Does `npm run lint` run clean (see Unit
5 — this is `tsc --noEmit`, not eslint)? Did I run the relevant tests? Is my
PR description clear about *why*, not just *what*? You're done with this
unit when you've opened one real PR (even a trivial one, like a docs typo
fix) following that checklist, and you can walk through how you'd resolve a
merge conflict if `git pull` ever reported one.

---

## Unit 3 — JavaScript (via MDN)

**Why you need this.** Almost every file in this codebase is JavaScript, or
TypeScript (JavaScript with types layered on top — Unit 4). You cannot read
this repo, let alone change it, without this unit. Learn it in this order:
variables, functions, objects and arrays, then asynchronous code
(promises/`async`/`await`) — that's the exact sequence you'll need to make
sense of a real file here, because almost every function in this repo that
touches the database or the network is `async`.

**Resource.** MDN's "Learn web development" hub, which is the canonical free
JavaScript curriculum: <https://developer.mozilla.org/en-US/docs/Learn_web_development>.
Work through the JavaScript modules in the order above — variables and
functions, then objects/arrays, then asynchronous JavaScript.

**Repo anchor.** Once you've done the async section, open
`lib/findings/normalize-url.ts`. It's short (about 20 lines) on purpose — a
good first real file to read:

```ts
export function normalizeFindingUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  u.hash = ''
  let out = u.toString()
  if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
  return out
}
```

Ignore the `: string` bits for now — that's TypeScript, and Unit 4 is where
those click into place. Everything else here is plain JavaScript you just
learned: a `try`/`catch`, a built-in `URL` object, string methods, and a
single `return`. This function takes a messy URL (fragment, trailing slash,
mixed case) and normalizes it so two different-looking URLs that point at the
same page compare equal — exactly the kind of thing you've done by hand
comparing URLs in a Screaming Frog export.

**Capability check.** You can explain, in your own words and without looking
it up, what `normalizeFindingUrl` does line by line, including why the
`try`/`catch` is there (a string that isn't a valid URL would otherwise
throw and crash whatever called this function) — and you can write a small
standalone function of your own (even five lines) that takes an array,
loops over it, and returns a new value using at least one `async`/`await`
call (a `fetch` to any public API is fine).

---

## Unit 4 — TypeScript (the official Handbook)

**Why you need this.** This entire codebase is TypeScript, not plain
JavaScript. Types are labels that describe the *shape* of the data flowing
through a function — the same instinct you already use reading a Screaming
Frog CSV header row and knowing "this column is always a number, this one is
always a URL." TypeScript just makes that checking automatic and catches
mismatches before the code ever runs.

**Resource.** The official TypeScript Handbook:
<https://www.typescriptlang.org/docs/handbook/intro.html>. Focus on the
basics chapters — everyday types, interfaces, and narrowing (the `try`/`catch`
pattern you just read is a form of narrowing: TypeScript knows `u` is
definitely a `URL` after the `try` block succeeds).

**Repo anchor.** Open `lib/ada-audit/types.ts` and read the top third of the
file. Look specifically at:

```ts
export interface StoredAxeResults {
  violations: AxeViolation[]
  passes: { id: string; help: string; nodes: { html: string }[] }[]
  incomplete: { id: string; help: string; impact: ImpactLevel | null; nodes: AxeNode[] }[]
  inapplicable: { id: string; help: string }[]
  timestamp: string
  url: string
  testEngine: { name: string; version: string }
  testRunner: { name: string }
  domElementCount?: number
  captureScreenshots?: boolean
  archived?: boolean
  archivedCounts?: ArchivedCounts
}
```

That `interface` is a label for exactly the JSON blob axe-core (the
accessibility-testing library) hands back after auditing a page — the same
JSON you'd otherwise be squinting at in a browser console. `violations:
AxeViolation[]` means "an array of `AxeViolation` objects"; `domElementCount?:
number` means "an optional number." The `?` matters: it means some audits
(older ones) simply don't have that field, and the code that reads this type
has to handle that.

**Capability check.** You can point at three fields in `StoredAxeResults` and
say what real-world data each one holds and why it's typed the way it is
(array vs. single value, optional vs. required, string vs. a named type like
`ImpactLevel`) — and you can write a five-field TypeScript `interface`
describing a client record (name, domain, some optional fields) from
scratch.

---

## Unit 5 — Node.js basics

**Why you need this.** This app doesn't run in a browser tab the way a static
WordPress page does — it's a Node.js process, started and kept alive by a
process manager on the server, running the same JavaScript/TypeScript you
just learned outside of any browser. Understanding "what is a server
process" and "what does `npm` actually do" is the bridge from writing
JavaScript to running this app.

**Resource.** Node.js's own "Learn" getting-started guide:
<https://nodejs.org/en/learn/getting-started/introduction-to-nodejs>. It
covers what Node is, running scripts, and the basics of `npm` and
`package.json` — exactly what you need, nothing more.

**Repo anchor.** Open `package.json` and read the `"scripts"` block:

```json
"scripts": {
  "dev": "next dev --turbopack",
  "build": "NODE_OPTIONS='--max-old-space-size=3072' next build",
  "start": "next start",
  "lint": "tsc --noEmit",
  "test": "vitest run"
}
```

Each key is a name you invoke with `npm run <name>` (or, for a couple of
very common ones, just `npm <name>`). `npm run dev` starts the local
development server with live reload. `npm run build` produces a production
build. `npm test` runs the automated test suite (Vitest). **`npm run lint`
here is `tsc --noEmit`** — the TypeScript compiler checking your types are
consistent, *not* eslint or any style linter. If someone on this project says
"run lint," they mean "run the type checker," not "check my formatting."

**Capability check.** You can explain, without looking it up, what each of
`npm run dev`, `npm run lint`, `npm test`, and `npm run build` does and why
they're different commands, and you can state correctly that "lint" on this
project means type-checking, not style-checking.

---

## Unit 6 — HTTP, APIs, JSON, and browser DevTools

**Why you need this.** Every tool in this app is a browser page talking to a
server over HTTP — the same protocol you already reason about constantly in
SEO work (status codes, redirects, headers). This unit turns that intuition
into the vocabulary you need to read this codebase's API routes and to debug
them the way you'd debug a crawl issue: by watching the actual requests.

**Resource.** MDN's HTTP documentation hub:
<https://developer.mozilla.org/en-US/docs/Web/HTTP> — read the overview and
the pages on status codes and JSON (`JSON.stringify`/`JSON.parse` are how
JavaScript turns data into the JSON you send/receive over HTTP). For DevTools
itself, Chrome's own Network panel docs:
<https://developer.chrome.com/docs/devtools/network>.

**Repo anchor, part 1 — the cookie gate.** Open `middleware.ts` and read
`isPublicPath` and the `middleware` function at the bottom. Notice this file
runs on *every* request to the app (that's what the `config.matcher` at the
bottom does) before any page or API route runs. If a request isn't for one of
the explicitly public paths (login, share links, `/api/health`, a small list
of token-authed handoff routes) and doesn't carry a valid signed auth cookie,
it gets redirected to `/login` (for a page) or a 401 JSON response (for an
API call). This is why "a brand-new route I just added 401s unexpectedly" is
a common first mistake — a new path isn't in the public list, so the cookie
gate blocks it by default, which is the intended, secure-by-default
behavior.

**Repo anchor, part 2 — the error envelope.** Open `lib/api/with-route.ts`:

```ts
export function withRoute<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (err) {
      if (err instanceof Response) return err
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.code }, { status: err.status })
      }
      // ... Prisma-specific error mapping ...
      console.error('[api] unhandled route error', err)
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
  }
}
```

Every API route wraps its handler in this function so that no matter what
goes wrong inside it, the caller always gets back a well-formed JSON error
with a sensible status code instead of a raw stack trace or a hung request.

**Repo anchor, part 3 — trace a real route.** Open your browser's DevTools,
go to the Network tab, and load `/api/health` (`app/api/health/route.ts` is
the file behind it — one of the simplest routes in the app, and one of the
few that's public, so you don't need to be logged in to hit it). Watch the
request in the Network tab: the method (`GET`), the status code (200 when
healthy, 503 if the database ping fails), and the JSON response body
(`{ status, uptimeSec, version }`). That round trip — browser sends a
request, server runs a handler, server sends back JSON, browser reads it —
is the same shape as every other API call in this app, just usually gated
behind the login cookie you just read about.

**Capability check.** You can explain, in one sentence each, why
`middleware.ts` runs before every request and why `withRoute` wraps every API
handler — and you can open the Network tab, load `/api/health`, and correctly
identify the request method, status code, and JSON body without help.

---

## Unit 7 — React fundamentals

**Why you need this.** Every page in this app is built out of React
components — small, reusable pieces of UI that manage their own state.
Before you can read or change a single page under `app/` or `components/`,
you need components, props, state, and effects.

**Resource.** The official React docs' own learning path:
<https://react.dev/learn>. Work through components and props, state, and
effects (`useEffect`) — you don't need the more advanced material yet.

**Repo anchor.** Open `components/ThemeToggle.tsx` in full — it's short:

```tsx
'use client'

import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { theme, toggle, mounted } = useTheme()

  if (!mounted) {
    return <div className="w-8 h-8" aria-hidden="true" />
  }

  return (
    <button onClick={toggle} aria-label={/* ... */}>
      {/* sun or moon icon depending on theme */}
    </button>
  )
}
```

This is a real, complete component: it reads shared state (`theme`,
`mounted`) from a context hook, and renders a button that flips the theme
when clicked. The one thing worth pausing on is the `if (!mounted)` guard at
the top: the server doesn't know yet whether the user's browser prefers dark
or light mode, so on the very first render it renders an empty placeholder
box instead of guessing — **that one line exists specifically to avoid a
"hydration mismatch,"** where the server-rendered HTML and the first
client-rendered HTML disagree and React complains (or briefly flickers the
wrong icon).

**Capability check.** You can explain what props, state, and an effect each
are, in your own words — and you can explain, in one sentence, why
`ThemeToggle` renders an empty box instead of an icon until `mounted` is
true.

---

## Unit 8 — Next.js App Router (via Next.js Learn)

**Why you need this.** This app is built on Next.js, specifically its "App
Router" — the system that turns folders and files under `app/` into pages
and API routes, and that distinguishes code that runs on the server from
code that runs in the browser. This is the layer that ties everything from
Units 6 and 7 together into an actual running page.

**Resource.** The official Next.js Learn course:
<https://nextjs.org/learn>. Focus on the App Router material: pages and
layouts, route handlers (the `route.ts` files behind API endpoints — you
already saw one in Unit 6), and the distinction between server components
(the default; they can talk to the database directly) and client components
(marked `'use client'` — like `ThemeToggle`, from Unit 7 — because they need
to run in the browser, e.g. to respond to a click).

**Repo anchor.** Pick one tool and trace it from folder to screen — the
`/robots-validator` page is a good first one because it's simple, or use one
you're already curious about. Find its folder under `app/`, open the
`page.tsx` inside it, and follow the imports outward: which components does
it render, does it fetch data on the server or the client, and does it call
any API route under `app/api/`? You're not trying to understand every line
— you're tracing the shape: folder → page file → components → (maybe) an API
route.

**Capability check.** You can name the file that renders one specific tool's
main page, say whether it's a server or client component and how you know
(the presence or absence of `'use client'` at the top), and describe in
plain language what happens between a user loading that page and something
appearing on screen.

---

## Unit 9 — SQL + Prisma basics

**Why you need this.** Everything this app remembers — clients, audits,
crawl results, findings — lives in a SQLite database, and the app talks to
it through Prisma, a tool that lets you query the database using
JavaScript/TypeScript instead of writing raw SQL by hand. You need enough SQL
to know what a table, row, and relation *are*, and enough Prisma to read the
schema that defines this app's entire data model.

**Resource.** For SQL fundamentals, SQLite's own documentation:
<https://www.sqlite.org/docs.html> (its "Query Language Understood by
SQLite" page covers the basics — tables, `SELECT`, joins). For Prisma,
the official docs hub <https://www.prisma.io/docs> and specifically the
SQLite guide: <https://www.prisma.io/docs/orm/overview/databases/sqlite>.

**Repo anchor.** Open `prisma/schema.prisma` and read it top to bottom.
Alongside it, once it exists, keep `03-codebase-tour.md`'s data-model section
open — it walks through *why* the models are shaped the way they are (the
origin models like `SiteAudit` and `AdaAudit` versus the normalized findings
tables like `CrawlRun`/`CrawlPage`/`Finding`). For now, just get comfortable
with the Prisma syntax itself: a `model` block is a table, each line inside
it is a column with a type, and lines like `client Client? @relation(...)`
are foreign-key relationships — the same "this table points at that table"
idea you already use thinking about how a crawl's pages relate to the crawl
itself.

**Capability check.** You can point at any one `model` block in
`prisma/schema.prisma` and correctly identify: which fields are required vs.
optional, at least one relation to another model, and what real-world thing
(a client, an audit, a finding) that table represents.

---

## Where to go next

Once you've worked through these nine units — in whatever order relative to
Stage 0/1 of `05-milestones.md` made sense for you — you're ready for
`02-local-setup.md`: getting the app running on your own machine. If you
haven't already started clicking through the live app while you worked
through this path, that's the natural next step regardless.
