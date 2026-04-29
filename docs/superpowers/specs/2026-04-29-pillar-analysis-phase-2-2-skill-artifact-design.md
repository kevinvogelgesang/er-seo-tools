# Pillar Analysis Phase 2.2 — Skill Artifact + Narrative Writeback Design Spec

**Date:** 2026-04-29
**Owner:** Kevin Vogelgesang
**Status:** Draft for review
**Target repo:** `kevinvogelgesang/er-seo-tools`
**Branch:** `feature/pillar-analysis-phase-1` (Phase 2 work continues here until merge; if scope grows, split into `feature/pillar-analysis-phase-2`)

---

## 1. Goal

Ship the Claude skill artifact + narrative writeback endpoint as one bundled unit. The analyst clicks "Copy Claude Prompt" (Phase 2.1), pastes into Claude Desktop / claude.ai web / Claude Code, and the skill ingests the prompt → fetches the structured analysis → generates the strategic memo → PATCHes it back to the dashboard. The dashboard stores the memo for analyst reference and (in a future Phase 2.3) renders it in the UI.

## 2. Non-goals (Phase 2.2 scope only)

- **Rendering the narrative on the dashboard** — explicitly punted to Phase 2.3. The PATCH endpoint stores the memo; the UI stays unchanged. The analyst can view the stored memo via the existing `GET /api/pillar-analysis/[id]` for now.
- **Memo regeneration UX** — Phase 2.3 territory. Re-running the skill PATCHes a fresh memo; whether the dashboard exposes a "regenerate" button is a 2.3 question.
- **Replacing real-client memo examples for the few-shot template** — synthetic examples ship now, real client memos refresh the template later.
- **Skill discovery / marketing** — distribution is "manual ZIP share with the team" for now.
- **Cross-environment writeback safety** — flagged in Phase 2.1 spec §6 risk; not actionable for current single-prod RunCloud topology.

## 3. Architecture

Two layers, bundled in one PR.

### 3.1 Backend (er-seo-tools)

- **`PATCH /api/pillar-analysis/[id]/narrative`** — accepts a JWT in the `Authorization: Bearer pat_*` header, verifies it via `verifyPillarToken` (Phase 2.1), confirms the token's `sub` matches the path id, confirms `'narrative-write'` scope, then writes `narrative` body field to `aiNarrative` and updates `narrativeUpdatedAt`. Returns `{ok: true, updatedAt}` on success.
- **Tighten `GET /api/pillar-analysis/[id]` to require Bearer auth.** Currently public — anyone with an analysis UUID can fetch client data. UUIDs are unguessable but still leak via screenshots, logs, browser history. The skill (the only external consumer of this endpoint) already sends the bearer token from the clipboard payload, so adding the requirement is non-breaking for the actual user flow. The dashboard server component uses Prisma directly, not this API endpoint, so it's unaffected. Same JWT verification path as PATCH but checks `'read'` scope instead of `'narrative-write'`. Returns the same structured error codes for auth failures.

**Leave `GET /api/pillar-analysis/by-session/[sessionId]` public** — that endpoint is consumed by the audit-page polling button which doesn't have a token. The by-session endpoint already returns a trimmed payload (no `urlVerdicts`, etc.), so the data exposure surface is small. Phase 3 can revisit if needed.

These two backend changes (PATCH endpoint + GET auth tightening) are the new backend surface. All other webapp infra (mint-token, by-session polling, dashboard page) already shipped in Phase 2.1.

### 3.2 Skill artifact

A folder at `skills/pillar-analysis-narrative/` containing:

- `SKILL.md` — activation pattern + execution flow + narrative-staleness rule
- `scripts/fetch_analysis.py` — reference Python implementation: parse payload, GET analysis JSON
- `scripts/post_narrative.py` — reference Python implementation: PATCH narrative back
- `templates/memo_structure.md` — strict 6-section template with 2 synthetic full examples
- `README.md` — install instructions for Claude Desktop ZIP upload + Claude Code filesystem

**Build script** at `scripts/build-skill.sh` (or `.ts`) packages the folder as `dist/skills/pillar-analysis-narrative-<version>.zip`. The build:

1. Copies `skills/pillar-analysis-narrative/*` into a staging dir.
2. Copies `docs/screaming-frog-setup.md` into the staging dir's `templates/` (single source of truth — the docs/ copy is canonical, build mirrors it into the skill).
3. Zips the staging dir.
4. Logs the output path.

Versioning: read `version` from the SKILL.md frontmatter (or a sibling `version.txt`). Manual bumps; no CI integration.

## 4. PATCH narrative endpoint

### 4.1 Request shape

```http
PATCH /api/pillar-analysis/{id}/narrative
Authorization: Bearer pat_eyJ...
Content-Type: application/json

{
  "narrative": "## Bottom line\n\n..."
}
```

### 4.2 Response shape

**Success (200):**

```json
{
  "ok": true,
  "updatedAt": "2026-04-29T15:42:18.000Z"
}
```

**Errors:**

| Status | `error` field | When |
|---|---|---|
| 400 | `invalid_json` | Body isn't parseable JSON |
| 400 | `narrative_required` | Body missing/empty `narrative` string |
| 400 | `narrative_too_long` | Narrative exceeds 50,000 characters (sanity cap) |
| 401 | `auth_missing` | No `Authorization: Bearer` header |
| 401 | `auth_malformed` | Header doesn't match `Bearer pat_*` shape |
| 401 | `token_expired` | JWT past `exp` |
| 401 | `token_invalid_signature` | Signature failed |
| 401 | `token_wrong_analysis_id` | JWT `sub` doesn't match path id |
| 401 | `token_missing_scope` | JWT lacks `narrative-write` scope |
| 404 | `not_found` | Analysis doesn't exist |
| 500 | `token_service_unavailable` | Token verification threw (e.g. prod missing secret) |

Distinct error codes match Phase 2.1 spec §11.6 — the skill UI surfaces actionable guidance per code.

### 4.3 Side effects

- Sets `aiNarrative = body.narrative` on the `PillarAnalysis` row.
- Sets `narrativeUpdatedAt = now()` on the same row.
- No invalidation of other tokens — multiple writes from the same token are fine within the 1h window.

### 4.4 Validation order

1. Parse body → `invalid_json` if fails.
2. Validate `narrative` field shape → `narrative_required` / `narrative_too_long`.
3. Read `Authorization` header → `auth_missing` / `auth_malformed`.
4. Verify token via `verifyPillarToken(token, id)` → `token_expired` / `token_invalid_signature` / `token_wrong_analysis_id` / `token_service_unavailable`.
5. Check token scope includes `'narrative-write'` → `token_missing_scope`.
6. Find analysis → `not_found`.
7. Update row + return 200.

The body validation runs BEFORE auth so a malformed request gets a specific 400 instead of a generic 401, which helps the skill author distinguish "I sent bad data" from "my token is wrong."

## 5. Skill folder structure

```
skills/pillar-analysis-narrative/
├── SKILL.md
├── version.txt          ← single source of truth for skill version (e.g. "1.0.0")
├── scripts/
│   ├── fetch_analysis.py
│   └── post_narrative.py
├── templates/
│   └── memo_structure.md
└── README.md
```

**Why `version.txt` instead of YAML frontmatter parsing:** the build script needs to read the version. Parsing YAML with `awk` is brittle (whitespace sensitivity, quote handling). A dedicated single-line file is robust: `cat version.txt` always works, no parser dependency. SKILL.md references the version too; a sentence in the README notes that the source of truth is `version.txt`.

The SF setup doc gets copied in by the build script (it doesn't live in the source tree under `skills/` to avoid duplicating `docs/screaming-frog-setup.md`).

After build:

```
dist/skills/pillar-analysis-narrative/
├── SKILL.md
├── scripts/
│   ├── fetch_analysis.py
│   └── post_narrative.py
├── templates/
│   ├── memo_structure.md
│   └── screaming-frog-setup.md   ← copied by build script
└── README.md
```

## 6. SKILL.md content

Frontmatter + activation instructions + execution flow. The model invoking the skill sees this as its primary spec.

**Key elements (summarized; full text drafted in the implementation plan):**

- **YAML frontmatter:** `name`, `description`, `version`. The `description` field is what Claude uses to decide when to activate the skill — must mention the distinctive markers (`pat_` token + `Analysis ID:` line) so it doesn't false-fire.
- **Activation pattern:** the user message must contain both `Analysis ID:` and `pat_` for the skill to engage.
- **Execution flow (numbered steps):**
  1. Parse `Webapp:`, `Analysis ID:`, `Access token: pat_*` from the user message. Validate token shape (`pat_[A-Za-z0-9._-]+`). If any missing or malformed → ask user to re-copy.
  2. GET the analysis using `scripts/fetch_analysis.py` as the reference pattern. Run the equivalent Python in the code-execution sandbox.
  3. Read `templates/memo_structure.md` for the section schema and few-shot examples.
  4. Generate the memo section-by-section. Strict template — use the exact section names; respect the per-section length guidance.
  5. PATCH the memo back via `scripts/post_narrative.py` reference pattern. Handle distinct token-error codes (see §4.2) with actionable user-facing messages.
  6. Reply in the chat with a one-screen summary + the dashboard URL.
- **Narrative-staleness rule (hard requirement):** if the user revises the memo within the conversation ("tweak the migration sequence"), re-PATCH the new version. The dashboard is the source of truth; silent in-chat edits leave it stale.
- **Error handling table:** map each `error` code from §4.2 to user-facing message + suggested action.
- **Output format for the chat reply:** short, scannable, includes dashboard URL. Includes `dataCompleteness` if <100% so the analyst sees the data-confidence flag.

## 7. Memo template (strict, 6 sections)

`templates/memo_structure.md` documents:

### 7.1 Section schema

| # | Section name (markdown header) | Length | Content |
|---|---|---|---|
| 1 | `## 1. Bottom line` | 1–3 sentences | "Worth it" / "Worth it but later" / "Don't bother — fix X first." |
| 2 | `## 2. Score interpretation` | 1 paragraph | What the 1–10 means for *this* site. Names the weakest subscore explicitly. |
| 3 | `## 3. Hub recommendation` | 2 paragraphs | Picked format + reasoning + runner-up + how close the call was. |
| 4 | `## 4. Pillar topics` | One subsection per cluster | Cluster name, anchor URL, cluster-page count, topical strength, one risk. |
| 5 | `## 5. Migration sequencing` | 1 paragraph + ordered list | First / second / third action items. |
| 6 | `## 6. Caveats` | Bulleted list | Missing data, low-confidence verdicts, sample-size warnings. |

Total: 600–1000 words.

### 7.2 Few-shot examples

Two synthetic full-length example memos in `templates/memo_structure.md`, modeled on plausible client analyses:

- **Example A: "career college, score 8, anchor-rich" — confident pillar opportunity.** Shows the model what a clean, high-confidence memo looks like. Pillars are program + location anchors; catchall is small.
- **Example B: "thin site, score 4, missing data" — pump-the-brakes memo.** Shows how to write the "don't bother yet, fix X first" framing. dataCompleteness ~60%, internal-link gap is high but content volume is too thin to support pillars.

Both examples are 800-ish words, demonstrate every section, and use markdown headers exactly as the schema demands.

A third "real client" example will be added after Phase 2.2 ships and we run a few real analyses through the skill — that's a future small commit, not in this spec's scope.

### 7.3 Voice

Internal, blunt. Per the original Phase 1 spec: "the client never sees the output. Voice is direct and pragmatic — accuracy matters more than diplomacy." The few-shot examples model this voice explicitly (e.g. "Don't pillar this site yet — program pages are confused commercial/informational and need to be fixed first.")

## 8. scripts/fetch_analysis.py — reference

A small, clear Python reference the skill model can read. Doesn't have to actually execute as a script — the model uses it as a pattern. Mirrors the structured-error pattern from `post_narrative.py` (§9) so a 401/404/500 doesn't hand the LLM a raw traceback.

```python
"""
Reference: GET the structured pillar analysis for the given access token.

The skill model reads this file to understand the API shape, then writes
equivalent code in its code-execution sandbox.
"""
import json
import sys
import urllib.request
import urllib.error

def fetch_analysis(webapp_url: str, analysis_id: str, token: str) -> dict:
    url = f"{webapp_url.rstrip('/')}/api/pillar-analysis/{analysis_id}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        # Surface the structured error body for the skill to map to user-facing copy.
        try:
            body = json.loads(e.read())
        except (ValueError, OSError):
            body = {"error": "unparseable_response"}
        return {"_status": e.code, **body}
    except urllib.error.URLError as e:
        # Network-level failure (DNS, refused, timeout). No structured body.
        return {"_status": 0, "error": "network_error", "reason": str(e.reason)}

if __name__ == "__main__":
    webapp, aid, tok = sys.argv[1], sys.argv[2], sys.argv[3]
    print(json.dumps(fetch_analysis(webapp, aid, tok), indent=2))
```

After §3.1's GET-tightening change, this endpoint requires the bearer token. The script's existing `Authorization` header is the right shape — no follow-up change needed.

## 9. scripts/post_narrative.py — reference

```python
"""
Reference: PATCH the narrative memo back to the analysis row.
"""
import json
import sys
import urllib.request
import urllib.error

def post_narrative(webapp_url: str, analysis_id: str, token: str, narrative: str) -> dict:
    url = f"{webapp_url.rstrip('/')}/api/pillar-analysis/{analysis_id}/narrative"
    body = json.dumps({"narrative": narrative}).encode()
    req = urllib.request.Request(
        url, data=body, method="PATCH",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        # Surface the structured error body for the skill to map to user-facing copy.
        return {"_status": e.code, **json.loads(e.read())}

if __name__ == "__main__":
    webapp, aid, tok = sys.argv[1], sys.argv[2], sys.argv[3]
    narrative = sys.stdin.read()
    print(json.dumps(post_narrative(webapp, aid, tok, narrative), indent=2))
```

## 10. Build script

`scripts/build-skill.sh` (Bash, simple):

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_SRC="$REPO_ROOT/skills/pillar-analysis-narrative"
SF_DOC="$REPO_ROOT/docs/screaming-frog-setup.md"
DIST_DIR="$REPO_ROOT/dist/skills"
STAGING="$DIST_DIR/pillar-analysis-narrative"

# Version is a single line in version.txt — robust against YAML formatting drift.
VERSION_FILE="$SKILL_SRC/version.txt"
[ -f "$VERSION_FILE" ] || { echo "ERROR: $VERSION_FILE missing" >&2; exit 1; }
VERSION=$(tr -d ' \n\r\t' < "$VERSION_FILE")
[ -n "$VERSION" ] || { echo "ERROR: version.txt is empty" >&2; exit 1; }

# Verify the source dir has the expected files before building.
for f in SKILL.md README.md scripts/fetch_analysis.py scripts/post_narrative.py templates/memo_structure.md; do
  [ -f "$SKILL_SRC/$f" ] || { echo "ERROR: $SKILL_SRC/$f missing" >&2; exit 1; }
done
[ -f "$SF_DOC" ] || { echo "ERROR: $SF_DOC missing (build needs to copy it into the skill)" >&2; exit 1; }

rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -r "$SKILL_SRC"/* "$STAGING/"
cp "$SF_DOC" "$STAGING/templates/screaming-frog-setup.md"

cd "$DIST_DIR"
ZIP_NAME="pillar-analysis-narrative-${VERSION}.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" "pillar-analysis-narrative/"

echo "Built: $DIST_DIR/$ZIP_NAME"
```

The pre-build sanity loop catches structural breakage before zipping (e.g. someone deleted `templates/memo_structure.md`). Failing loud at build time beats shipping an incomplete ZIP.

Wired in `package.json` as `"build:skill": "bash scripts/build-skill.sh"`. Add `dist/` to `.gitignore` if not already.

## 11. README.md (in the skill folder)

Internal install + usage instructions for the team. Covers:

1. **Claude Desktop install:** `Customize → Skills → + Create skill → upload <zip>`. Confirm enabled in skills list.
2. **claude.ai web install:** identical to Claude Desktop (same chat surface).
3. **Claude Code install:** `unzip pillar-analysis-narrative-*.zip -d ~/.claude/skills/`. The folder appears at `~/.claude/skills/pillar-analysis-narrative/`. Restart Claude Code (or reload the skill index) to pick it up.
4. **Usage:** click "Copy Claude Prompt" on the dashboard, paste into Claude (any of the three surfaces), wait for the memo to write back. Open the analysis dashboard to see the stored memo.
5. **Troubleshooting:** mismatched analysis ID (token-wrong-analysis-id), expired token (re-copy), webapp unreachable (check VPN), sandbox blocked (skill needs Python code-execution available — Free tier may not have it).

## 12. Tests

### 12.1 PATCH endpoint

`app/api/pillar-analysis/[id]/narrative/route.test.ts` — covers each error branch + success:

1. 400 invalid_json (malformed body)
2. 400 narrative_required (missing field)
3. 400 narrative_too_long (>50k chars)
4. 401 auth_missing (no header)
5. 401 auth_malformed (wrong header shape)
6. 401 token_wrong_analysis_id (token sub mismatch — uses the existing pillar-token helpers)
7. 401 token_missing_scope (JWT lacks 'narrative-write' — requires custom-minted token in test)
8. 404 not_found
9. 200 success — writes aiNarrative + narrativeUpdatedAt, returns ok+updatedAt

Total ~9 tests. Mocks `@/lib/db` like the mint-token tests do.

The `token_expired` and `token_invalid_signature` paths are well-covered by the existing `lib/pillar-token.test.ts` — no need to retest at the route level.

### 12.2 GET endpoint auth tightening

`app/api/pillar-analysis/[id]/route.test.ts` — three new tests for the auth tightening:

1. 401 auth_missing (no Authorization header)
2. 401 token_missing_scope (token lacks 'read' scope)
3. 200 success — token with 'read' scope returns the full payload

The existing GET wasn't tested at the route level (only end-to-end via the dashboard). Adding these three tests now codifies the new contract.

### 12.3 Prompt-format contract test

`lib/pillar-prompt-contract.test.ts` (new) — a small regression test that **renders the same payload format the dashboard button produces** and runs the skill's regex over it. Asserts that all three fields (`Webapp:`, `Analysis ID:`, `Access token: pat_*`) are extractable. This catches drift between the frontend prompt template and the skill activation regex — see §13 below.

### 12.2 Skill artifact

No automated tests for the SKILL.md / scripts / templates — they're prompts and reference code, not executable units we own end-to-end. Instead:

- **Manual smoke test post-deploy:** install the skill in Claude Desktop, click Copy Claude Prompt on a real analysis, verify the skill activates, generates a coherent memo, and the dashboard's `aiNarrative` column gets populated.
- **Unit test on `scripts/build-skill.sh`** is overkill — Bash failures will be obvious during the smoke test.

## 13. Acceptance criteria

- [ ] PATCH endpoint round-trips: mint token via Phase 2.1 endpoint, PATCH narrative, GET it back via existing endpoint, verify `aiNarrative` matches.
- [ ] All 9 PATCH route tests pass.
- [ ] All 3 GET route auth tests pass (auth-missing, scope-missing, success).
- [ ] Prompt-format contract test passes (`lib/pillar-prompt-contract.test.ts`).
- [ ] All existing 873 vitest tests still pass.
- [ ] `npm run build:skill` produces a valid ZIP at `dist/skills/pillar-analysis-narrative-<v>.zip` containing all 7 files (SKILL.md, version.txt, README.md, scripts/, templates/) including the copied-in SF setup doc and prompt-contract doc.
- [ ] Manual: install the ZIP in Claude Desktop, click Copy Claude Prompt on a complete analysis, paste into the chat, verify:
  - The skill activates (the model recognizes the prompt pattern).
  - The model generates all 6 sections per the strict template.
  - The dashboard's `aiNarrative` column gets populated within ~30 seconds.
  - The chat reply includes the dashboard URL + the score + completeness flag.

## 14. Risks and open items

1. **Skill activation reliability.** Whether Claude consistently activates the skill on the pasted payload depends on description-matching at the platform level. If activation is flaky, the SKILL.md `description` field can be tightened with more distinctive markers.
2. **Sandbox availability.** Some Claude tiers may not have Python code-execution enabled; the skill will fail to make the HTTP calls. README troubleshooting flags this. Phase 2.3+ could add an MCP-server fallback if it becomes a real friction.
3. **Memo quality drift over time.** As Claude models update, the few-shot examples may produce different output. The strict template (named sections + lengths) is the primary anchor; periodic re-review of generated memos catches drift.
4. **Size limits on chat-pasted text.** A very long pasted prompt + the skill's reference reads could push context limits. Empirically this hasn't been a problem; flagging for awareness.
5. **No automated test of the skill end-to-end.** Manual smoke test is the only validation. If the skill regresses (e.g., a model update changes how it interprets the SKILL.md), we'd find out via real use, not via CI. Acceptable trade-off given the artifact's prompt-like nature.
6. **Token expiration UX friction.** 1-hour JWT expiry means an analyst who pauses (lunch, meeting) and resumes the chat to revise the memo will hit `token_expired` and have to navigate back to the dashboard, copy a fresh prompt, and paste it. Acceptable V1 limitation — flagging as known friction. If real use surfaces it as a frequent annoyance, options: (a) increase expiry to 4–8h with the security tradeoff acknowledged, (b) add a "regenerate access token" button on the dashboard that returns just the token without regenerating the full payload.

## 15. Prompt-format contract

The Phase 2.1 button (`composePayload` in `CopyClaudePromptButton.tsx`) and the Phase 2.2 skill regex (in `SKILL.md`) **must stay in sync**. If the button format changes — even adding/removing whitespace — the skill might silently fail to activate or parse fields.

To prevent drift:

1. **Single source of truth doc** at `docs/pillar-prompt-contract.md` (new file in this spec's scope) that locks the field labels, separator format, and example payload.
2. **Cross-reference comments** in both files. `CopyClaudePromptButton.tsx` `composePayload`: `// Format defined in docs/pillar-prompt-contract.md. Update both there and the skill regex if you change this.` Same comment at the top of the skill's parsing section.
3. **Regression test** (§12.3) renders the button's payload and runs the skill's regex over it. If anyone diverges either side, the test fails.

The doc lives in `docs/`, gets copied into the skill ZIP at build time alongside the SF setup doc — same single-source pattern.

## 16. Out of scope (deferred to Phase 2.3 or later)

- Rendering `aiNarrative` on the dashboard (next phase).
- "Regenerate narrative" UI affordance.
- Diffing successive narrative versions / version history.
- Cross-environment writeback safety (preview-deploy concerns).
- Sharing the memo externally (the analyst can copy from the dashboard manually).
