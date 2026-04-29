# Pillar Analysis Narrative — Skill

Internal Claude skill for Enrollment Resources analysts. Pairs with the
er-seo-tools `/pillar-analysis/[id]` dashboard. Activates when the
analyst pastes a clipboard payload from the dashboard's "Copy Claude
Prompt" button. Generates a strategic memo and posts it back to the
dashboard for storage.

## Install

### Claude Desktop / claude.ai web

1. Build the ZIP: from the er-seo-tools repo root, run `npm run build:skill`.
   Output: `dist/skills/pillar-analysis-narrative-<version>.zip`.
2. In Claude Desktop or claude.ai web: open Customize → Skills → Create skill.
3. Upload the ZIP.
4. Confirm the skill appears in your Skills list and is enabled.

### Claude Code

1. Build the ZIP (same as above).
2. Unzip into the user-skills directory:

       unzip -o dist/skills/pillar-analysis-narrative-*.zip -d ~/.claude/skills/

3. Restart Claude Code (or trigger a skill index reload) to pick it up.
4. Verify: `ls ~/.claude/skills/pillar-analysis-narrative/` shows
   `SKILL.md`, `version.txt`, `scripts/`, `templates/`, `README.md`.

## Usage

1. Open a complete pillar analysis at `/pillar-analysis/[id]` in
   er-seo-tools.
2. Click "Copy Claude Prompt" in the page header.
3. Paste into Claude (any of the three surfaces).
4. Wait for the skill to fetch the analysis, generate the memo, and PATCH
   it back. The chat reply confirms with a summary + dashboard URL.
5. Reload the dashboard to see the stored memo (Phase 2.3 will render
   it in-page; until then, the memo is in the `aiNarrative` column —
   visible via the GET endpoint or direct DB query).

## Updating the memo

If you ask Claude to revise the memo within the same chat ("tweak the
migration sequence," "make the bottom line harsher"), the skill MUST
re-PATCH the dashboard automatically. This is enforced by SKILL.md.

If you start a new chat, you'll need a fresh prompt — JWT tokens expire
after 1 hour. Just click Copy Claude Prompt again on the dashboard.

## Troubleshooting

- **"Couldn't parse the prompt"** — One or more of `Webapp:`, `Analysis ID:`,
  `Access token:` fields is missing or malformed. Re-copy from the
  dashboard.
- **"Token expired (1h limit)"** — Tokens are short-lived. Re-copy from
  the dashboard.
- **"Token signature invalid"** — Webapp redeployed since the token was
  minted (the signing secret rotated). Re-copy.
- **"Couldn't reach webapp"** — Check VPN if remote, or confirm the
  webapp is running.
- **Skill doesn't activate** — The pasted message must contain literal
  `Analysis ID:` and `pat_` substrings. If you tweaked the format
  manually, restore the original copy from the button.
- **"This skill needs the Python code-execution tool"** — Some Claude
  tiers don't have Python sandbox access. The analyst will need to
  manually generate the memo using the structured analysis JSON visible
  at the dashboard URL.

## Reference docs (copied in by the build script)

- `templates/screaming-frog-setup.md` — full SF setup recipe for the
  three er-seo-tools use cases. Source: `docs/screaming-frog-setup.md`
  in the er-seo-tools repo.
- The prompt format contract (what fields the skill expects) is
  documented at `docs/pillar-prompt-contract.md` in the er-seo-tools
  repo. The build script does NOT copy it into the skill — it's a
  developer-facing doc, not analyst-facing.

## Versioning

Source of truth: `version.txt`. Bump it manually when shipping a new
version of the skill. The build script reads it to name the output ZIP.
