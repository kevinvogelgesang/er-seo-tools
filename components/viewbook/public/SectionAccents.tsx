// PR7 Task 10: decorative code-owned SVG accents for the public viewbook's
// section frames — a corner bracket, a hairline tick divider, and a stacked-
// dot column. Purely decorative geometry, tinted via the client's brand
// --vb-secondary / --vb-tertiary vars at low opacity so it recedes behind
// real content regardless of the chosen theme. Pure SERVER components: no
// "use client", no hooks, no state — just inline SVG. `aria-hidden="true"`
// on every root so screen readers never announce them. LIGHT-ONLY by design
// (the public viewbook's brand surfaces don't carry a dark mode) — no `dark:`
// classes anywhere in this file.
export function CornerBracket({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      width="48"
      height="48"
      fill="none"
      className={className}
    >
      <path
        d="M4 28V12a8 8 0 0 1 8-8h16"
        stroke="var(--vb-secondary)"
        strokeOpacity="0.45"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="4" cy="60" r="3" fill="var(--vb-tertiary)" fillOpacity="0.5" />
    </svg>
  )
}

export function TickDivider({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 160 12"
      width="160"
      height="12"
      fill="none"
      className={className}
    >
      <line x1="0" y1="6" x2="60" y2="6" stroke="var(--vb-tertiary)" strokeOpacity="0.4" strokeWidth="1.5" />
      <path d="M76 0 L84 6 L76 12" stroke="var(--vb-secondary)" strokeOpacity="0.55" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="100" y1="6" x2="160" y2="6" stroke="var(--vb-tertiary)" strokeOpacity="0.4" strokeWidth="1.5" />
    </svg>
  )
}

export function DotStack({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 8 64"
      width="8"
      height="64"
      fill="none"
      className={className}
    >
      <circle cx="4" cy="4" r="3" fill="var(--vb-secondary)" fillOpacity="0.5" />
      <circle cx="4" cy="20" r="2.25" fill="var(--vb-tertiary)" fillOpacity="0.4" />
      <circle cx="4" cy="34" r="1.75" fill="var(--vb-tertiary)" fillOpacity="0.35" />
      <circle cx="4" cy="46" r="1.25" fill="var(--vb-secondary)" fillOpacity="0.35" />
      <circle cx="4" cy="56" r="1" fill="var(--vb-tertiary)" fillOpacity="0.35" />
    </svg>
  )
}
