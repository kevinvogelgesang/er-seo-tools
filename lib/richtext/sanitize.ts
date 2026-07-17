import sanitizeHtml from 'sanitize-html';

/**
 * The ONE rich-text sanitizer used on both write and read for viewbook
 * assessment content (general notes / user-behaviour notes). Strict
 * allowlist — no attributes of any kind (no href, no style, no data-*),
 * no links/images/embeds/scripts. Disallowed tags are discarded but their
 * inner text is kept (never dropped wholesale).
 */
const ALLOWED_TAGS = ['h2', 'h3', 'p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li'] as const;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: {},
  allowedStyles: {},
  disallowedTagsMode: 'discard',
};

export function sanitizeRichText(dirty: string): string {
  if (typeof dirty !== 'string') return '';
  if (dirty.trim() === '') return '';
  return sanitizeHtml(dirty, SANITIZE_OPTIONS);
}
