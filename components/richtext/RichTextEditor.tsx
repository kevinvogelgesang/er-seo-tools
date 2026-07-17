'use client'

// Viewbook UX pass, Lane 4 Task 3 — the reusable minimal WYSIWYG editor.
//
// Dependency-free by design (spec: self-contained) — a `contentEditable`
// region driven by `document.execCommand` plus a small toolbar. This is NOT
// a controlled component in the usual React sense: React never owns the
// DOM inside the editable region (fighting a contentEditable's live cursor
// on every keystroke is exactly the bug controlled-contentEditable patterns
// cause). Instead:
//
//   - `value` seeds the region ONCE, on mount.
//   - After that, an incoming `value` only overwrites the live DOM when it
//     is a genuine EXTERNAL change — i.e. it differs from the html this
//     editor itself last emitted via `onChange`. A prop update that's just
//     the parent echoing back our own last `onChange` call is a no-op, so
//     typing never gets clobbered by its own round-trip through parent
//     state.
//   - Every edit (typing, toolbar action, paste, drop) re-reads
//     `innerHTML` and calls `onChange` with it. The caller (and
//     `RichTextRenderer` at render time) is responsible for sanitizing —
//     this component emits raw contentEditable output.
//
// Paste/drop hardening (plan-review fix 3): `sanitizeRichText` protects
// storage and render, but NOT the live editing DOM before the user hits
// submit. A paste of `<img onerror=...>` or a dropped rich snippet would
// otherwise sit in the DOM (and be visible/executable-ish in edge cases)
// until the next save round-trip. So `onPaste`/`onDrop` both intercept,
// `preventDefault()`, and insert PLAIN TEXT ONLY via `execCommand`
// ('insertText') — never the clipboard's/drag payload's HTML.
import { useEffect, useRef } from 'react'

const TOOLBAR_ACTIONS: Array<{ label: string; ariaLabel: string; command: string; value?: string }> = [
  { label: 'H2', ariaLabel: 'Heading 2', command: 'formatBlock', value: 'h2' },
  { label: 'H3', ariaLabel: 'Heading 3', command: 'formatBlock', value: 'h3' },
  { label: 'B', ariaLabel: 'Bold', command: 'bold' },
  { label: 'I', ariaLabel: 'Italic', command: 'italic' },
  { label: 'U', ariaLabel: 'Underline', command: 'underline' },
  { label: '• List', ariaLabel: 'Bullet list', command: 'insertUnorderedList' },
  { label: '1. List', ariaLabel: 'Numbered list', command: 'insertOrderedList' },
]

// `execCommand` is deprecated but universally supported in real browsers.
// Some non-browser DOM environments (notably jsdom, used by this file's own
// test suite) don't implement it at all — calling it throws a TypeError
// rather than no-op'ing. Guard so those environments degrade to
// "formatting is a no-op, onChange still fires" instead of crashing.
function runExecCommand(command: string, value?: string): void {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return
  try {
    document.execCommand(command, false, value)
  } catch {
    // See above — environments without a real execCommand implementation.
  }
}

export function RichTextEditor({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (html: string) => void
  ariaLabel: string
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  // The last html this editor itself emitted (or seeded from) — used to tell
  // "the parent echoed our own change back" apart from "the value changed
  // out from under us" (e.g. a reset, or another editor session's write).
  const lastEmittedRef = useRef<string | null>(null)

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (lastEmittedRef.current === null) {
      // First mount: seed once. SSR-safe — the server renders an empty
      // contentEditable div (no dangerouslySetInnerHTML), and the client
      // fills it here, so there is no hydration markup to reconcile.
      el.innerHTML = value
      lastEmittedRef.current = value
      return
    }
    if (value !== lastEmittedRef.current && value !== el.innerHTML) {
      el.innerHTML = value
      lastEmittedRef.current = value
    }
  }, [value])

  function emitChange() {
    const el = editorRef.current
    if (!el) return
    const html = el.innerHTML
    lastEmittedRef.current = html
    onChange(html)
  }

  function exec(command: string, commandValue?: string) {
    editorRef.current?.focus()
    runExecCommand(command, commandValue)
    emitChange()
  }

  function insertPlainText(text: string) {
    editorRef.current?.focus()
    runExecCommand('insertText', text)
    emitChange()
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    insertPlainText(event.clipboardData.getData('text/plain'))
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    insertPlainText(event.dataTransfer.getData('text/plain'))
  }

  return (
    <div className="rounded border border-gray-300 dark:border-navy-border">
      <div
        role="toolbar"
        aria-label="Text formatting"
        className="flex flex-wrap gap-1 border-b border-gray-300 bg-gray-50 p-1 dark:border-navy-border dark:bg-navy-card"
      >
        {TOOLBAR_ACTIONS.map((action) => (
          <button
            key={action.ariaLabel}
            type="button"
            aria-label={action.ariaLabel}
            // Keep the current selection alive: a normal mousedown would
            // blur the contentEditable region (moving focus to the button)
            // BEFORE the click's execCommand runs, losing the range the
            // command was meant to apply to.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => exec(action.command, action.value)}
            className="rounded px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:text-white/80 dark:hover:bg-navy-border"
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        onInput={emitChange}
        onPaste={handlePaste}
        onDrop={handleDrop}
        className="min-h-24 w-full p-2 text-sm text-gray-900 focus:outline-none dark:bg-navy-card dark:text-white"
      />
    </div>
  )
}
