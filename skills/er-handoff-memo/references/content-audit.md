# cat_ Content Audit — contract

The `cat_` handoff audits a **completed site audit's page content** and writes
back **structured findings** (no markdown document). This reference is the full
contract; SKILL.md §9 is the summary. Internal use only.

## The flow

1. **Manifest** — `handoff.py fetch` (`GET /api/content-audit/{id}/manifest`).
   Returns:
   ```json
   {
     "client": { "id": 1, "name": "…" } | null,
     "domain": "example.edu",
     "completedAt": "…",
     "textAvailable": true,
     "retainUntil": "…" | null,
     "pages": [ { "url": "https://…", "title": "…", "wordCount": 512, "contentAvailable": true } ]
   }
   ```
   `pages` is the **eligible set**: indexable (2xx, HTML, not noindex) and not a
   login/utility page. It is the ONLY set you may cite as evidence.

2. **Per-page text** — `handoff.py page --url <page-url>`
   (`GET /api/content-audit/{id}/page?url=…`). Returns
   `{ url, contentText, contentTruncated }` — the stripped main-content text
   (nav/header/footer/aside already removed, ≤30k chars, `contentTruncated:true`
   if it was clipped).
   - **`410` / `text_unavailable`**: the 1-hour retention window closed (or the
     mint happened after the base window). `textAvailable:false` on the manifest
     signals this up front. **Fall back to web-fetching the page URL** — the
     manifest still lists the pages; you just fetch the live page instead of the
     retained text. Say so if it materially changes coverage.
   - **`404`**: the URL is not in this audit's eligible set. Do not retry with a
     guessed URL.

3. **Analyze** across pages:
   - **data_inconsistency** — the same fact stated differently on two+ pages:
     tuition figures, program length/duration, start/enrollment dates, contact
     info, accreditation claims. This is the highest-value category (it needs no
     external source of truth — the disagreement itself is the finding).
   - **stale_claim** — dated content that has likely expired: old copyright
     years, past seasons/terms ("Apply for Fall 2023"), deadlines in the past.
   - **quality_issue** — thin/confusing/off-intent content, contradictory
     messaging, or a page that doesn't answer what it's clearly meant to.

4. **Write back** — `handoff.py findings` (`PATCH /api/content-audit/{id}/findings`).
   Pipe a JSON array (or `{"findings":[...]}`) to stdin.

## Finding schema (server-validated — reject, not truncate)

```json
{
  "type": "data_inconsistency" | "stale_claim" | "quality_issue",
  "severity": "info" | "warning" | "critical",
  "title": "short label, ≤ 2000 chars",
  "detail": "what was found + why it matters, ≤ 2000 chars",
  "evidence": [ { "url": "<a URL from the manifest page set>", "snippet": "≤ 2000 chars" } ],
  "recommendation": "concrete next step, ≤ 2000 chars"
}
```

Server-enforced limits (a violation rejects the WHOLE PATCH with a 400):
- ≤ 200 findings; ≤ 20 evidence items per finding; each string ≤ 2000 chars;
  total serialized payload ≤ 256 KB (`findings_too_large`).
- **Every `evidence.url` MUST be a URL present in the manifest `pages` set**
  (normalized) — anything else → 400 `evidence_url_not_in_audit`. A
  cross-page-consistency finding references the 2+ pages that disagree; all must
  be in-audit URLs.
- Unknown `type`/`severity`, missing fields, or a malformed shape → 400
  `invalid_findings`.

Last-writer-wins: a second PATCH replaces the stored set entirely. If you refine,
send the COMPLETE set, not a delta.

## Honest-phrasing rules

- **Detection proves presence, never absence.** If you can't find a fact, that is
  "not found on the audited pages — verify", never "the site is wrong" or
  "confirmed missing". Frame `data_inconsistency` as "these pages state X
  differently", not "X is incorrect" (you don't know the true value).
- Severity: `critical` for a live factual contradiction a prospect would act on
  (conflicting tuition/dates); `warning` for stale claims and softer
  inconsistencies; `info` for quality nits. Don't inflate.
- Quote the smallest snippet that shows the issue; don't paste whole paragraphs.
- If `textAvailable:false` and you web-fetched instead, note that the analysis
  used the live pages (which may differ from the audited snapshot).

## Reply in chat — one short screen

Site name (`domain`), the counts by type/severity, and the dashboard link
`{Webapp}/ada-audit/site/{siteAuditId}` (SEO tab → Content Audit card shows the
findings). If any page fell back to web-fetch or the window was closed, say so in
one clause.

## Errors

Map any `error_kind` from `handoff.py` per SKILL.md §2. Specific to cat_:
`no_live_scan_run` (409) means the audit has no SEO run yet — it isn't ready for a
content audit; tell the user to re-mint once the SEO tab shows results.
`body_too_large` (413) / `findings_too_large` (400) mean trim the set or the
snippets. Never fabricate findings to fill a quota — zero findings is a valid,
honest result ("no cross-page inconsistencies or stale claims detected on the
N audited pages").
