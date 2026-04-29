# Pillar Analysis Phase 2.1 — Clipboard Prompt UX Design Spec

**Date:** 2026-04-29
**Owner:** Kevin Vogelgesang
**Status:** Draft for review
**Target repo:** `kevinvogelgesang/er-seo-tools`
**Branch:** `feature/pillar-analysis-phase-1` (continuing for now; new branch only when this part lands and we move to Phase 2.2)

---

## 1. Goal

Ship the clipboard-prompt UX in isolation so the analyst can click a button, paste a payload somewhere, and verify the integration shape end-to-end before the skill artifact (Phase 2.2) is built. This is the foundational backend + UI piece for Phase 2's "paste this prompt into Claude" flow.

## 2. Non-goals (Phase 2.1 scope only)

- The Claude skill itself (`SKILL.md`, scripts, templates, ZIP packaging) — Phase 2.2.
- The `PATCH /api/pillar-analysis/[id]/narrative` endpoint — Phase 2.3.
- Rendering the narrative memo on the dashboard — Phase 2.3.
- "Regenerate narrative" affordance — Phase 2.3.

## 3. Architecture

### 3.1 New backend

- **`POST /api/pillar-analysis/[id]/mint-token`** — mints a short-lived JWT scoped to that specific analysis ID. Stateless (signed, not DB-stored). Returns `{ token: string, expiresAt: string }`.

### 3.2 New UI

- **"Copy Claude Prompt" button** on `/pillar-analysis/[id]`. Visible when `status === 'complete'`. Click flow:
  1. POST to `mint-token` endpoint for this analysis ID.
  2. Compose the clipboard payload from the returned token + analysis ID + webapp URL.
  3. `navigator.clipboard.writeText(payload)`.
  4. Flash a "Copied!" affordance for ~2 seconds.
- **"Generate Claude prompt"** secondary link on the `/seo-parser/results/[sessionId]` pillar card (when `status === 'complete'`). Deep-links to `/pillar-analysis/[id]#copy-prompt` — no token minting from this surface, just navigates. Dashboard auto-highlights the button on hash match.

## 4. Token design

JWT, signed with HS256, payload:

```json
{
  "iss": "er-seo-tools",
  "aud": "pillar-analysis-narrative",
  "sub": "<pillarAnalysisId>",
  "scope": ["read", "narrative-write"],
  "iat": <unix>,
  "exp": <unix + 3600>
}
```

The skill (Phase 2.2) and the eventual PATCH narrative endpoint (Phase 2.3) will validate the token by:
1. Verifying the HS256 signature against `PILLAR_TOKEN_SECRET`.
2. Confirming `aud === "pillar-analysis-narrative"`.
3. Confirming `sub === pillarAnalysisId` from the URL path.
4. Confirming `exp > now`.
5. Confirming required scope is in the `scope` array.

**Token format:** the literal returned string is `pat_` + the JWT body. The `pat_` prefix is for human recognition in the clipboard payload (matches the "skill activation pattern" agreed in the original spec). The skill activation match looks for `pat_eyJ...`.

## 5. Token secret management

New env var: `PILLAR_TOKEN_SECRET`.

- **Production (RunCloud):** set in `~/.env` next to existing `DATABASE_URL`. 32+ random bytes (base64).
- **Dev:** if `PILLAR_TOKEN_SECRET` is unset, the mint endpoint falls back to a deterministic dev-only constant (`'dev-pillar-token-secret-do-not-use-in-prod'`) and logs a warning. This keeps `npm run dev` working out of the box.
- Add to `.env.example` with a placeholder value and a comment.

The secret rotates only manually. Rotation invalidates all outstanding tokens — acceptable since they expire in 1h anyway.

## 6. Clipboard payload format

Plain text, exactly:

```
Run a pillar analysis narrative on this site.

Webapp: {NEXT_PUBLIC_APP_URL}
Analysis ID: {pillarAnalysisId}
Access token: {token}
(Expires in 1h)

Fetch the structured analysis, write the internal strategic memo, and post it back to the dashboard.
```

`{NEXT_PUBLIC_APP_URL}` comes from the same env var used elsewhere (e.g. by the existing share-token feature). Defaults to `http://localhost:3000` in dev.

## 7. UI details

### 7.1 Dashboard button

Lives in the existing dashboard header area on `/pillar-analysis/[id]`, to the right of the title or just below the subtitle line. Specific:

- Anchor element with `id="copy-prompt"` so the deep link from §3.2 lands on it.
- Default state: orange brand accent (`bg-[#f5a623] text-[#1c2d4a] hover:bg-[#e8971a]`) — matches the SEO audit page's "Try Again" button style.
- "Copied!" state: 2s green flash (`bg-green-500 text-white`) + brief checkmark icon, then reverts.
- Disabled when `status !== 'complete'` (greyed out, tooltip explains why).
- Keyboard: focusable, Enter triggers the click flow.

### 7.2 Pillar card secondary link

The existing `PillarAnalysisCardClient` (`app/seo-parser/results/[sessionId]/components/PillarAnalysisCardClient.tsx`) currently shows score + "Open dashboard →" button when complete. Add a small secondary link below the dashboard button:

- Text: `Generate Claude prompt →`
- Style: subdued (`text-xs text-blue-600 dark:text-blue-400 hover:underline`)
- Target: `/pillar-analysis/{id}#copy-prompt`

The dashboard handles the hash on mount: if `window.location.hash === '#copy-prompt'`, scroll the button into view and apply a subtle pulse/highlight for ~2 seconds.

### 7.3 Error states

- Network error during mint: button shows red "Mint failed — retry" for 3s, reverts.
- Clipboard API unavailable (older browsers / Safari without HTTPS in dev): fall back to selecting the payload text in a prompt or modal so the user can manually copy. Detection: `navigator.clipboard?.writeText` is undefined.

## 8. Implementation surface

| Area | File | Change |
|---|---|---|
| Token signing | `lib/pillar-token.ts` (new) | `mintPillarToken(analysisId)` + `verifyPillarToken(token, analysisId)` helpers |
| Mint endpoint | `app/api/pillar-analysis/[id]/mint-token/route.ts` (new) | POST handler that 404s on missing analysis, 409s if not complete, 200s with token |
| Dashboard button | `app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx` (new) | Client component |
| Dashboard wiring | `app/pillar-analysis/[id]/page.tsx` (modify) | Render button in header area; pass analysis ID + status |
| Hash-handler | `app/pillar-analysis/[id]/components/CopyPromptHashHandler.tsx` (new, client) | Effect on mount that handles `#copy-prompt` |
| Pillar card link | `app/seo-parser/results/[sessionId]/components/PillarAnalysisCardClient.tsx` (modify) | Add secondary link in complete-state render |
| Env config | `.env.example` (modify) | `PILLAR_TOKEN_SECRET=...` placeholder + comment |
| Dependency | `package.json` | Add `jose` (JWT library) — modern, well-maintained, no native bindings |

## 9. Tests

- **Unit:** `lib/pillar-token.test.ts` — round-trip mint + verify, expiration, wrong analysis id rejection, invalid signature rejection, malformed token rejection (~6 tests).
- **Route integration:** `app/api/pillar-analysis/[id]/mint-token/route.test.ts` — three thin tests covering the route's branching: 404 on missing analysis, 409 when status !== 'complete', 200 with valid token shape on success. Uses the same Prisma test pattern as existing API route tests.
- **No UI test** — manual smoke covers the button click + clipboard write. Browser API mocking adds friction without much value here.

## 10. Acceptance criteria

- [ ] Click "Copy Claude Prompt" on a complete pillar analysis. Clipboard contains the formatted payload with a `pat_eyJ...` token.
- [ ] Paste the token into a JWT decoder; verify `sub` matches the analysis ID, `aud === "pillar-analysis-narrative"`, `exp` is ~1h ahead.
- [ ] Click "Generate Claude prompt →" on the seo-parser pillar card. Browser navigates to the dashboard; button is visible and visually highlighted.
- [ ] Try the button on an analysis with `status !== 'complete'`. Button is disabled with a tooltip.
- [ ] Set `PILLAR_TOKEN_SECRET` in `.env.local`, restart dev server, verify the dev-warning is gone and tokens still mint correctly.
- [ ] All existing 862 vitest tests still pass; new token-helper tests pass (~6 tests added).

## 11. Risks and open items

1. **`jose` is a new dep.** Mature, MIT-licensed, used by NextAuth and many others. Pure JS, no native bindings. Low risk; flagging for awareness.
2. **`navigator.clipboard.writeText` requires HTTPS or localhost.** RunCloud serves over HTTPS in production; dev is on localhost; both are fine. Won't work over plain HTTP if someone tunnels/proxies the site weirdly.
3. **Secret rotation invalidates outstanding tokens immediately.** Acceptable given the 1h expiry baseline. If we ever need overlapping rotation windows (multi-secret JWKS), that's a Phase 3 problem.
4. **The skill activation pattern depends on `pat_` prefix and the literal phrase "Analysis ID:".** Phase 2.2 will reuse those exact strings in SKILL.md — keeping them stable in this spec is intentional.

## 12. What we're learning from this spike

After implementation, we'll inspect:
- Does the button feel naturally placed, or does the header get crowded?
- Is the deep-link from the seo-parser card discoverable?
- Does the clipboard payload have the right shape for the eventual skill to parse?
- Any unexpected friction (clipboard permissions, env-var setup, etc.)?

The answers feed Phase 2.2 (skill artifact) — we may revise the payload shape based on what we learn before locking it in via the skill's activation regex.
