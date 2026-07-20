'use client'

// Paired color control (2026-07-19): a native color swatch + an EDITABLE hex
// field. The native picker's panel format (RGB vs HEX) is browser UI we
// cannot control, so the hex field is the first-class way to enter an exact
// brand code — type or paste `#122033` (the leading `#` is optional) and it
// commits as soon as the value parses; the swatch stays for visual pick-and-
// tweak. Replaces the old read-only <code> hex echo in ThemeEditor and the
// operator theme pane.
import { useEffect, useState } from 'react'

const HEX_RE = /^#?([0-9a-fA-F]{6})$/

function normalize(raw: string): string | null {
  const match = HEX_RE.exec(raw.trim())
  return match ? `#${match[1].toLowerCase()}` : null
}

export function HexColorInput({
  label,
  value,
  onChange,
  swatchClassName,
  fieldClassName,
}: {
  label: string
  value: string // canonical '#rrggbb'
  onChange: (next: string) => void
  swatchClassName: string
  fieldClassName: string
}) {
  const [text, setText] = useState(value.toUpperCase())

  // Adopt an EXTERNAL value change (swatch drag, background refresh) into the
  // text field — but never clobber in-progress typing whose normalized form
  // already equals the value (each valid keystroke round-trips through
  // onChange and back here).
  useEffect(() => {
    setText((current) => (normalize(current) === value.toLowerCase() ? current : value.toUpperCase()))
  }, [value])

  return (
    <span className="flex min-w-0 items-center gap-2">
      <input
        type="color"
        aria-label={`${label} color`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={swatchClassName}
      />
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        maxLength={7}
        aria-label={`${label} hex code`}
        value={text}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const parsed = normalize(next)
          if (parsed) onChange(parsed)
        }}
        onBlur={() => {
          // Discard an invalid partial — snap back to the committed value.
          if (normalize(text) === null) setText(value.toUpperCase())
        }}
        className={fieldClassName}
      />
    </span>
  )
}
