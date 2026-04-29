---
name: pillar-analysis-narrative
description: |
  Use this when the user pastes a clipboard payload from the er-seo-tools
  Pillar Analysis dashboard. The payload contains the lines "Webapp:",
  "Analysis ID:", and "Access token: pat_..." (a JWT). Fetches the
  structured analysis, writes a strategic memo, and posts it back to
  the dashboard. Internal use only at Enrollment Resources.
version: 1.0.1
---

# Pillar Analysis Narrative

Internal skill for Enrollment Resources analysts. Activates when the user
pastes a payload from the Pillar Analysis dashboard's "Copy Claude Prompt"
button.

## When to activate

The user message must contain ALL of:

- A line matching `Webapp:` followed by a URL
- A line matching `Analysis ID:` followed by a Prisma cuid
- A line matching `Access token: pat_` followed by a JWT

If any field is missing, ask the user to copy a fresh prompt from the
dashboard. Do not attempt the flow with partial fields.

## Execution flow

The expected shape is one fetch + one memo write + one PATCH. Don't
chain inspection scripts to slice the response — the GET endpoint is
already trimmed to a narrative-shaped payload (see "Response shape"
below). Read it, write the memo, post it back.

### 1. Parse the payload

Extract three fields from the user's message:

- `webappUrl` — value after `Webapp:`
- `analysisId` — value after `Analysis ID:`
- `token` — value after `Access token: ` (must start with `pat_`)

Reference parser code: `scripts/fetch_analysis.py` shows the expected
structure. Whitespace tolerance: tabs and multiple spaces around the
colon are fine. The contract is locked at
`docs/pillar-prompt-contract.md` (in the repo) and copied into this
skill at build time.

If any field can't be parsed, reply: "Couldn't parse the prompt — make
sure all three fields are present (Webapp, Analysis ID, Access token).
Click 'Copy Claude Prompt' on the dashboard again to refresh."

### 2. Fetch the structured analysis

Use the Python code execution sandbox to GET
`{webappUrl}/api/pillar-analysis/{analysisId}` with header
`Authorization: Bearer {token}`. The response is the narrative-shaped
analysis (see "Response shape" below). Read it directly — typical
size is 2–5K tokens, well within a single tool call's read budget.

If the response has a `_status` field (HTTP error from
`scripts/fetch_analysis.py` pattern), map it to a user-facing message
using the table under "Errors and fallbacks" below.

If you got a successful payload, proceed to step 3.

### 3. Read the memo template

Read `templates/memo_structure.md` (in this skill folder) for the strict
6-section schema and the two synthetic example memos. Match the section
names verbatim and respect the per-section length guidance.

### 4. Generate the memo

Write all six sections in markdown:

1. `## 1. Bottom line` — 1–3 sentences. "Worth it" / "Worth it but later" / "Don't bother — fix X first."
2. `## 2. Score interpretation` — 1 paragraph. Explicitly name the weakest subscore.
3. `## 3. Hub recommendation` — 2 paragraphs. Picked format with reasoning + runner-up + how close the call was.
4. `## 4. Pillar topics` — One subsection per cluster (use `### {Cluster name}`). Anchor URL, cluster-page count, topical strength, one risk per cluster.
5. `## 5. Migration sequencing` — 1 paragraph + ordered list.
6. `## 6. Caveats` — Bulleted list. Missing data, low-confidence verdicts, sample-size warnings.

Total target: 600–1000 words.

**Voice:** Internal, blunt. The client never sees this output. Accuracy
matters more than diplomacy. If the analysis says the site isn't ready
for pillar work, say so directly — see Example B in
`templates/memo_structure.md`.

### 5. Post the memo back

PATCH `{webappUrl}/api/pillar-analysis/{analysisId}/narrative` with the
generated memo as the `narrative` field. See `scripts/post_narrative.py`
for the request shape.

If the response has a `_status` error field, map per the error table.

### 6. Reply in chat with a one-screen summary

Format:

```
✓ Pillar analysis narrative posted for {site}

Score: {N}/10 — {one-line interpretation}{ — ⚠ {dataCompleteness}% data completeness if <100%}
Hub recommendation: {format} (alternate: {format}, {close call | clear winner})
Pillar topics: {N} clusters identified ({M} cluster pages, {K} leave-as-blog, {P} prune)
Narrative updated: just now

Dashboard: {webappUrl}/pillar-analysis/{analysisId}
```

Keep the chat reply short. The full memo lives in the dashboard.

## Response shape

The GET endpoint returns a narrative-friendly payload (~2–5K tokens):

- `score`, `subscores`, `subscorePresence`, `subscoreContext`, `dataCompleteness` — score data
- `hubRecommendation` — `{primary, alternates: [{format, scoreDelta}], reasoning}`
- `clusters[]` — replaces the raw `pillarTopics`. Each cluster has:
  - `clusterId`, `name`, `pillarUrl`, `pillarPageType`, `size`
  - `anchorStats` — title, h1, wordCount, inlinks, gscClicks, gscImpressions, gscPosition (or `null` for catchall clusters)
  - `sampleMembers[]` — up to 5 members, each `{url, title, verdict, verdictConfidence}`
- `verdictSummary` — counts per verdict bucket
- `totalUrls` — total URL count for sample-size sanity
- `lowConfidenceAssignments` — `{threshold, count, samples[]}` — feeds §6 Caveats
- `excludedAnchors[]` — program/location pages that didn't form clusters; `{url, pageType, reasoning}`. Use these for the "N anchor pages were excluded" caveat
- `id`, `sessionId`, `status`, `error`, `createdAt`, `updatedAt`

The full per-URL list is intentionally NOT in this response — it's not
needed for the memo and used to balloon the payload to 60K+ tokens for
content-rich sites.

## Narrative-staleness rule (hard requirement)

If the user asks you to revise the memo within the conversation
("tweak the migration sequence," "make the bottom line harsher"), you
MUST re-run step 5 (PATCH) with the revised memo. The dashboard is the
source of truth — silent in-chat edits leave the dashboard with stale
content.

This is not optional. After every memo revision, PATCH again.

## Errors and fallbacks

Map `_status` and `error` from `scripts/fetch_analysis.py` to user-facing copy:

| `_status` | `error` | Reply to user |
|---|---|---|
| 401 | `token_expired` | "Token expired (1h limit). Refresh er-seo-tools and click Copy Claude Prompt again." |
| 401 | `token_invalid_signature` | "Token signature invalid. Webapp may have been redeployed. Copy a fresh prompt." |
| 401 | `token_wrong_analysis_id` | "Token doesn't match this analysis ID. Did you mix up two clipboard payloads?" |
| 401 | `token_missing_scope` | "Token missing required scope. Copy a fresh prompt from the dashboard." |
| 403 | `network_blocked` | "The Claude environment's egress allowlist blocked the request to `{webappUrl}`. If you're running this in Claude Desktop / web / cloud sandbox, switch to **Claude Code** (which uses your local network) or have your Anthropic org admin add this domain to the bash sandbox allowlist. Headers received: `{response_headers}`." |
| 404 | (any) | "Analysis not found. Was it deleted?" |
| 0 | `network_error` | "Couldn't reach webapp. Check VPN if remote, then verify the URL in the prompt is correct." |

If the Python sandbox isn't available in the user's Claude tier, the
HTTP calls will fail before reaching this table. Tell the user: "This
skill needs the Python code-execution tool. If you're on a tier that
doesn't have it, the analyst can manually generate the memo using the
structured analysis JSON visible at the dashboard URL."
