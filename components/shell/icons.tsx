// components/shell/icons.tsx
// Hand-inlined 24-viewBox stroke icons for the app shell (no icon library —
// spec §9). All accept className so the shell controls size/color.

type IconProps = { className?: string }

function base(props: IconProps, children: React.ReactNode, strokeWidth = 1.9) {
  return (
    <svg aria-hidden="true" className={props.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

export function IconHome(p: IconProps) { return base(p, <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>) }
export function IconClients(p: IconProps) { return base(p, <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M16 4.6a3.2 3.2 0 0 1 0 6.7M17.5 15.2c1.9.6 3 2 3.4 4.3" /></>) }
export function IconSiteAudit(p: IconProps) { return base(p, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>) }
export function IconParser(p: IconProps) { return base(p, <><path d="M4 17V9m5 8V5m5 12v-6m5 6V8" /><path d="M3 21h18" /></>) }
export function IconReports(p: IconProps) { return base(p, <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>) }
export function IconRobots(p: IconProps) { return base(p, <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>) }
export function IconQuarter(p: IconProps) { return base(p, <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>) }
export function IconChecklist(p: IconProps) { return base(p, <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m4 5 1 1 2-2M4 11l1 1 2-2M4 17l1 1 2-2" /></>) }
export function IconRedirect(p: IconProps) { return base(p, <><path d="M4 12h13M13 6l6 6-6 6" /></>) }
export function IconBook(p: IconProps) { return base(p, <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-2.5" /></>) }
export function IconSettings(p: IconProps) { return base(p, <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" /></>) }
export function IconLogout(p: IconProps) { return base(p, <><path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15" /><path d="M12 9l-3 3m0 0 3 3m-3-3h12" /></>, 2) }
export function IconChevron(p: IconProps) { return base(p, <path d="M15 6l-6 6 6 6" />, 2) }
export function IconMenu(p: IconProps) { return base(p, <path d="M4 6h16M4 12h16M4 18h16" />, 2) }
export function IconClose(p: IconProps) { return base(p, <path d="M6 18L18 6M6 6l12 12" />, 2) }
