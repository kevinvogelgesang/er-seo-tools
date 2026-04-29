---
name: pillar-analysis-narrative
description: |
  Use this when the user pastes a clipboard payload from the er-seo-tools
  Pillar Analysis dashboard. The payload contains the lines "Webapp:",
  "Analysis ID:", and "Access token: pat_..." (a JWT). Fetches the
  structured analysis, writes a strategic memo, and posts it back to
  the dashboard. Internal use only at Enrollment Resources.
version: 1.0.0
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
`Authorization: Bearer {token}`. The response is the structured analysis
(score, subscores, hub recommendation, pillar topics, URL verdicts).

If the response has a `_status` field (HTTP error from
`scripts/fetch_analysis.py` pattern), map it to a user-facing message:

- `_status: 401, error: token_expired` → "Token expired (1h limit). Refresh er-seo-tools and click Copy Claude Prompt again."
- `_status: 401, error: token_invalid_signature` → "Token signature invalid. Webapp may have been redeployed. Copy a fresh prompt."
- `_status: 401, error: token_wrong_analysis_id` → "Token doesn't match this analysis ID. Did you mix up two clipboard payloads?"
- `_status: 404` → "Analysis not found. Was it deleted?"
- `_status: 0, error: network_error` → "Couldn't reach webapp. Check VPN if remote."

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

If the response has a `_status` error field, map per step 2's table.

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

## Narrative-staleness rule (hard requirement)

If the user asks you to revise the memo within the conversation
("tweak the migration sequence," "make the bottom line harsher"), you
MUST re-run step 5 (PATCH) with the revised memo. The dashboard is the
source of truth — silent in-chat edits leave the dashboard with stale
content.

This is not optional. After every memo revision, PATCH again.

## Errors and fallbacks

If the Python sandbox isn't available in the user's Claude tier, the
HTTP calls will fail. Tell the user: "This skill needs the Python
code-execution tool. If you're on a tier that doesn't have it, the
analyst can manually generate the memo using the structured analysis
JSON visible at the dashboard URL."
