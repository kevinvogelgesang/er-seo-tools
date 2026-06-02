# er-handoff-memo

Unified Claude skill for the three er-seo-tools dashboard handoffs. Lives in the
webapp repo (this is the source of truth) and is **installed** into
`~/.claude/skills/` via a symlink so it stays in sync with the routes it calls.

## What it does

The er-seo-tools dashboards each mint a short-lived token and copy a clipboard
prompt. This skill detects which workflow by the **token prefix**, fetches the
structured export, writes the right document, and PATCHes it back:

| Prefix | Workflow | Document | Teamwork push |
|--------|----------|----------|---------------|
| `pat_` | Pillar Analysis | strategic memo | — |
| `srt_` | SEO Audit Roadmap | technical-SEO roadmap | opt-in |
| `krt_` | Keyword Research | keyword strategy memo | — |

It **replaces** three previous skills (`pillar-analysis-narrative`,
`seo-audit-roadmap`, `keyword-strategy-memo`) — see `manifest.json`.

## Why the transport is an executed script

`scripts/handoff.py` is **run**, not used as a reference the model re-types. The
earlier per-skill fetch scripts were "reference" copies, and each re-derivation
dropped the `User-Agent` header (Cloudflare's WAF 403s the default urllib UA)
and carried a hardcoded "egress blocked" label that mis-explained a WAF 403.
Executing one CLI keeps the UA + the honest error taxonomy
(`cloudflare_waf` / `egress_blocked` / `app_gate` / `token_*` / `not_found` /
`network_unreachable` / …) in one tested place.

```bash
python3 scripts/handoff.py fetch --webapp <url> --token <tok> --id <id>
printf '%s' "$DOC" | python3 scripts/handoff.py post --webapp <url> --token <tok> --id <id> [--structured '<json>']
```

## Install

Symlink the repo copy into the skills dir (re-run after `git pull` is a no-op):

```bash
ln -sfn "$(pwd)/skills/er-handoff-memo" ~/.claude/skills/er-handoff-memo
```

The three old skills should be retired once the team is on this one. During
migration they are left as thin stubs that point here (so an old "run the SEO
roadmap skill" phrasing still lands correctly); remove them once unused.

## Layout

- `SKILL.md` — activation, prefix routing, shared fetch/error/post flow, the
  `srt_` completeness scope-note and Teamwork offer.
- `scripts/handoff.py` — the executed transport CLI (stdlib only).
- `templates/` — per-workflow document structures (ported verbatim) +
  `screaming-frog-setup.md` (analyst export guide).
- `references/teamwork-push.md` — the opt-in Teamwork push contract (srt_).
- `manifest.json` — core transport version + per-workflow template versions.
