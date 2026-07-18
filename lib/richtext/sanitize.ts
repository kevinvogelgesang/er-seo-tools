import sanitizeHtml from 'sanitize-html';

/**
 * The ONE rich-text sanitizer used on both write and read for viewbook
 * assessment content (general notes / user-behaviour notes). Strict
 * allowlist — no attributes of any kind (no href, no style, no data-*),
 * no links/images/embeds/scripts. Disallowed tags are discarded but their
 * inner text is kept (never dropped wholesale).
 *
 * codex-review P1 fix: Chromium's `execCommand`/contentEditable emits
 * `<b>`/`<i>` for bold/italic and wraps each Enter-created line in a
 * `<div>` — none of which were in the allowlist, so bold/italic vanished
 * and (worse) `<div>` blocks were discarded WITHOUT a separator, silently
 * concatenating adjacent lines (`first<div>second</div>` -> `firstsecond`).
 * `transformTags` maps the browser's tags onto the allowlisted equivalents
 * BEFORE the allowlist filter runs, so the semantics survive the
 * write/read round-trip instead of being stripped: `<b>`->`<strong>`,
 * `<i>`->`<em>`, `<div>`->`<p>` (a real paragraph break, not nothing).
 * `<u>` already round-trips as-is since it was already allowed.
 */
const ALLOWED_TAGS = ['h2', 'h3', 'p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li'] as const;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: {},
  allowedStyles: {},
  disallowedTagsMode: 'discard',
  transformTags: {
    b: 'strong',
    i: 'em',
    div: 'p',
  },
};

export function sanitizeRichText(dirty: string): string {
  if (typeof dirty !== 'string') return '';
  if (dirty.trim() === '') return '';
  return sanitizeHtml(dirty, SANITIZE_OPTIONS);
}

/**
 * codex-review P2: a contentEditable region the operator has cleared out
 * doesn't go back to an empty string on its own — Chromium leaves behind
 * `<br>` or `<div><br></div>`, which sanitizes to `<br />` / `<p><br
 * /></p>`. `.trim().length > 0` treats that as "has content", so a
 * cleared note was rendering an empty "General notes"/"User Behaviour"
 * heading on the public page with nothing under it.
 *
 * The ONE home of "is this rich-text HTML actually empty" — stripping
 * every tag and the one whitespace-flavored entity contentEditable is
 * known to emit (`&nbsp;`) and checking what's left. Used both to
 * normalize a break-only body to `''` at write time (`setAssessmentNote`)
 * and to harden the read-time presence check (`hasHtml` in
 * AssessmentSection.tsx) against rows written before this fix existed.
 */
export function isBlankRichText(html: string): boolean {
  if (typeof html !== 'string') return true;
  const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, '').trim();
  return text.length === 0;
}
