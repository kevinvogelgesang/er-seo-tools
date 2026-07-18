// Viewbook UX pass, Lane 4 Task 3 — the sanitizing rich-text renderer.
//
// This is a server-safe component (no client hooks). It ALWAYS re-runs
// `sanitizeRichText` on its `html` prop before injecting it, even though the
// same sanitizer already ran at write time (Task 2's `lib/richtext/sanitize.ts`
// write hooks). That write-time pass protects storage; this read-time pass
// protects render against a tampered/legacy row (e.g. a pre-sanitizer DB row,
// or a future write path that forgets to sanitize) — defense in depth, never
// trust the byte on disk to render safely just because it once was.
//
// LIGHT-ONLY: the public viewbook has no dark mode, so `.vb-richtext` carries
// no `dark:` variants (unlike the admin editor, which lives in a dark-mode
// surface).
import { sanitizeRichText } from '@/lib/richtext/sanitize'

export function RichTextRenderer({ html }: { html: string }) {
  const safe = sanitizeRichText(html)
  return (
    <div className="vb-richtext">
      <style>{`
        .vb-richtext { color: #1f2937; font-size: 0.9375rem; line-height: 1.6; }
        .vb-richtext h2 { margin: 1em 0 0.5em; font-size: 1.15em; font-weight: 700; color: #111827; }
        .vb-richtext h3 { margin: 1em 0 0.4em; font-size: 1.05em; font-weight: 600; color: #111827; }
        .vb-richtext p { margin: 0 0 0.75em; }
        .vb-richtext p:last-child { margin-bottom: 0; }
        .vb-richtext strong { font-weight: 700; }
        .vb-richtext em { font-style: italic; }
        .vb-richtext u { text-decoration: underline; }
        .vb-richtext ul, .vb-richtext ol { margin: 0 0 0.75em; padding-left: 1.25em; }
        .vb-richtext ul { list-style-type: disc; }
        .vb-richtext ol { list-style-type: decimal; }
        .vb-richtext li { margin: 0.15em 0; }
      `}</style>
      {/* `safe` is the sanitizer's own output, computed immediately above —
          never the raw `html` prop. */}
      <div dangerouslySetInnerHTML={{ __html: safe }} />
    </div>
  )
}
