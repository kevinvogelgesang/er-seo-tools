# Pillar Prompt Format Contract

**Status:** Locked. Do not change without updating ALL of:

1. `lib/pillar-prompt.ts` (`composePayload` + the regex constants).
2. `skills/pillar-analysis-narrative/SKILL.md` (the parsing instructions for Claude).
3. This document.
4. The regression test at `lib/pillar-prompt.test.ts` will catch composer/parser drift, but it cannot detect drift between this doc and either implementation. Manual review during PR is the only safeguard.

## Why a contract

The `composePayload` function on the dashboard button produces a clipboard payload. The skill's SKILL.md tells Claude how to extract three fields from that payload. If either side drifts, the skill silently fails to activate or fails to parse a field. Locking the format here keeps the surface explicit.

## The format

Plain text, exactly:

```
Run a pillar analysis narrative on this site.

Webapp: {webappUrl}
Analysis ID: {analysisId}
Access token: {token}
(Expires in 1h)

Fetch the structured analysis, write the internal strategic memo, and post it back to the dashboard.
```

Variables:
- `{webappUrl}` — public origin of the er-seo-tools deployment, e.g. `https://seo-tools.er.com`. No trailing slash.
- `{analysisId}` — Prisma cuid for the PillarAnalysis row, e.g. `cmok7ar8300059cdi5h3me91h`.
- `{token}` — JWT prefixed with `pat_`, e.g. `pat_eyJhbGciOiJIUzI1NiJ9.payload.signature`.

## Required fields and parser regex

The skill's parser must extract `webappUrl`, `analysisId`, and `token` from any pasted payload. The regex constants in `lib/pillar-prompt.ts` are the authoritative source:

```
^[ \t]*Webapp:[ \t]+(\S+)\s*$
^[ \t]*Analysis ID:[ \t]+(\S+)\s*$
^[ \t]*Access token:[ \t]+(pat_[A-Za-z0-9._-]+)\s*$
```

All three regexes use the multi-line flag (`m`). Whitespace tolerance: tabs and spaces are interchangeable around the colon and value; multiple spaces are accepted; leading whitespace is stripped.

## What the skill does with the parsed fields

- `webappUrl` + `analysisId` build the GET URL: `{webappUrl}/api/pillar-analysis/{analysisId}`.
- `token` is sent as the Bearer credential: `Authorization: Bearer {token}`.
- `webappUrl` + `analysisId` build the PATCH URL: `{webappUrl}/api/pillar-analysis/{analysisId}/narrative`.

## What changes are safe vs. unsafe

**Safe (no contract change):**
- Adjusting prose lines (the "Run a pillar analysis…" or "Fetch the structured analysis…" framing) — those are LLM-prompting context and don't have to match a regex.

**Unsafe (requires contract + regex + SKILL.md updates together):**
- Changing the field labels (`Webapp:`, `Analysis ID:`, `Access token:`) — case, spelling, or punctuation.
- Changing the token prefix (`pat_`).
- Adding required fields.
- Reordering: the parsers don't depend on order, but the SKILL.md may. Keep the order documented here.
