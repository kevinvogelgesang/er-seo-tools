# A8 PR 1 — Route Groups + Tools Registry + Left-Sidebar App Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top nav + dropdowns with a collapsible left-sidebar app shell (Direction A "Navy Command Deck"), splitting `app/` into `(app)`/`(public)` route groups so share/login pages never get app chrome.

**Architecture:** Root layout keeps only html/body/fonts/ThemeProvider + a combined anti-FOUC script (theme + sidebar state). A new `(app)` route-group layout mounts `AppShell` (sidebar + topbar + main); a `(public)` group keeps a minimal layout with the existing `Footer`. Nav content is data-driven from a new tools registry. Old `components/nav.tsx` is deleted in this PR — no dual-nav period.

**Tech Stack:** Next.js 15 App Router route groups, Tailwind (class dark mode, existing `navy`/`orange` tokens), vitest + @testing-library/react (`// @vitest-environment jsdom`, `globals:false` → manual `cleanup`), no new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-07-app-shell-redesign-design.md` (§3.1, §3.2, §8 PR 1, §9).
- Homepage CONTENT untouched in this PR (`app/page.tsx` moves into `(app)/` but its body is not edited — dashboard is PR 2).
- Public routes must render with ZERO app chrome: `/login`, `/about`, `/privacy`, `/share/*`, `/ada-audit/share/*`, `/ada-audit/site/share/*` (see `middleware.ts` `PUBLIC_PATH_PREFIXES` + `PUBLIC_EXACT_PATHS`).
- Sidebar: 248px expanded ↔ 68px icon rail; state in `localStorage('er-sidebar')`; pre-hydration stamp `data-sidebar="collapsed"` on `<html>`; sidebar surface is navy in BOTH themes.
- Logout affordance preserved: plain `<form action="/api/auth/logout" method="post">` (matches old nav — no JS fetch).
- No new npm packages; icons are hand-inlined SVG components.
- Use `git mv` for all moves (history preservation — Kevin's standing preference).
- Gates before PR: `npx tsc --noEmit` · `npx vitest run` · `npm run build`.

---

### Task 1: Tools registry + icon set

**Files:**
- Create: `components/shell/icons.tsx`
- Create: `lib/tools-registry.ts`
- Test: `lib/tools-registry.test.ts`

**Interfaces:**
- Produces: `ToolDef`, `NavGroupId`, `TOOLS: ToolDef[]`, `NAV_GROUPS: { id: NavGroupId; label: string }[]`, `toolForPathname(pathname: string): ToolDef | undefined` — consumed by Tasks 2, 4.
- Produces: icon components `IconHome, IconClients, IconSiteAudit, IconParser, IconReports, IconRobots, IconQuarter, IconChecklist, IconRedirect, IconBook, IconSettings, IconLogout, IconChevron, IconMenu, IconClose`, all `({ className }: { className?: string }) => JSX.Element`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/tools-registry.test.ts
import { describe, it, expect } from 'vitest'
import { TOOLS, NAV_GROUPS, toolForPathname } from './tools-registry'
import { isPublicPath } from '@/middleware'

describe('tools registry', () => {
  it('has unique ids and internal hrefs', () => {
    const ids = TOOLS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of TOOLS) {
      expect(t.href.startsWith('/')).toBe(true)
      for (const c of t.children ?? []) expect(c.href.startsWith('/')).toBe(true)
    }
  })

  it('every tool group exists in NAV_GROUPS or is footer', () => {
    const groupIds = new Set(NAV_GROUPS.map((g) => g.id))
    for (const t of TOOLS) {
      expect(t.group === 'footer' || groupIds.has(t.group)).toBe(true)
    }
  })

  // Codex fix 1 drift test: no registry destination may be a public path —
  // registry hrefs live inside the (app) shell; public pages have no nav entry.
  it('no registry href is a public path', () => {
    for (const t of TOOLS) {
      expect(isPublicPath(t.href), t.href).toBe(false)
      for (const c of t.children ?? []) expect(isPublicPath(c.href), c.href).toBe(false)
    }
  })

  it('toolForPathname matches longest prefix, exact for home', () => {
    expect(toolForPathname('/')!.id).toBe('home')
    expect(toolForPathname('/ada-audit/queue')!.id).toBe('site-audit')
    expect(toolForPathname('/seo-parser/results/abc')!.id).toBe('seo-parser')
    expect(toolForPathname('/clients/12')!.id).toBe('clients')
    expect(toolForPathname('/nonexistent')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tools-registry.test.ts`
Expected: FAIL — `Cannot find module './tools-registry'`

- [ ] **Step 3: Write the icon set**

```tsx
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
```

- [ ] **Step 4: Write the registry**

```ts
// lib/tools-registry.ts
// A6-absorbed single source of truth for the app-shell nav (spec §3.1).
// Homepage tool cards (PR 2) and search will render from this too.
import type { ComponentType } from 'react'
import {
  IconHome, IconClients, IconSiteAudit, IconParser, IconReports,
  IconRobots, IconQuarter, IconChecklist, IconRedirect, IconBook, IconSettings,
} from '@/components/shell/icons'

export type NavGroupId = 'overview' | 'run' | 'plan' | 'reference'

export interface ToolDef {
  id: string
  name: string
  href: string
  group: NavGroupId | 'footer'
  icon: ComponentType<{ className?: string }>
  description: string
  children?: { name: string; href: string }[]
}

export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'run', label: 'Run' },
  { id: 'plan', label: 'Plan' },
  { id: 'reference', label: 'Reference' },
]

export const TOOLS: ToolDef[] = [
  { id: 'home', name: 'Home', href: '/', group: 'overview', icon: IconHome, description: 'Quick-start dashboard' },
  {
    id: 'clients', name: 'Clients', href: '/clients', group: 'overview', icon: IconClients,
    description: 'Fleet scores, timelines & schedules',
    children: [
      { name: 'Fleet', href: '/clients' },
      { name: 'Manage clients', href: '/clients/manage' },
    ],
  },
  {
    id: 'site-audit', name: 'Site Audits', href: '/ada-audit', group: 'run', icon: IconSiteAudit,
    description: 'ADA + live SEO scans, schedules & queue',
    children: [
      { name: 'Run an audit', href: '/ada-audit' },
      { name: 'Audit queue', href: '/ada-audit/queue' },
      { name: 'Recents', href: '/ada-audit/recents' },
    ],
  },
  {
    id: 'seo-parser', name: 'SEO Parser', href: '/seo-parser', group: 'run', icon: IconParser,
    description: 'Screaming Frog uploads & crawl diffs',
    children: [
      { name: 'All sessions', href: '/seo-parser' },
      { name: 'Compare crawls', href: '/seo-parser/diff' },
    ],
  },
  { id: 'reports', name: 'SEO Reports', href: '/reports', group: 'run', icon: IconReports, description: 'GA4 + GSC branded client PDFs' },
  { id: 'robots-validator', name: 'Robots Validator', href: '/robots-validator', group: 'run', icon: IconRobots, description: 'robots.txt, sitemaps & AI-bot access' },
  { id: 'quarter-grid', name: 'Quarter Grid', href: '/quarter-grid', group: 'plan', icon: IconQuarter, description: 'Plan ~30 clients, push to Teamwork' },
  {
    id: 'eat-checklist', name: 'E-E-A-T Checklists', href: '/eat-checklist', group: 'plan', icon: IconChecklist,
    description: 'Content quality & audit checklists',
    children: [
      { name: 'Checklist', href: '/eat-checklist' },
      { name: 'Audit checklist', href: '/eat-checklist/audit' },
    ],
  },
  { id: 'rankmath-redirects', name: 'RankMath Redirects', href: '/rankmath-redirects', group: 'reference', icon: IconRedirect, description: 'WordPress redirect migration runbook' },
  { id: 'oxygen-guide', name: 'Oxygen Guide', href: '/oxygen-tailwind-guide', group: 'reference', icon: IconBook, description: 'Oxygen + Tailwind stack guide' },
  { id: 'settings', name: 'Settings', href: '/settings', group: 'footer', icon: IconSettings, description: 'Google connection & scoring weights' },
]

// Longest-prefix match so /ada-audit/queue → site-audit; '/' is exact-only.
export function toolForPathname(pathname: string): ToolDef | undefined {
  let best: ToolDef | undefined
  for (const t of TOOLS) {
    if (t.href === '/') {
      if (pathname === '/') return t
      continue
    }
    if (pathname === t.href || pathname.startsWith(t.href + '/')) {
      if (!best || t.href.length > best.href.length) best = t
    }
  }
  return best
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/tools-registry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add components/shell/icons.tsx lib/tools-registry.ts lib/tools-registry.test.ts
git commit -m "feat(shell): tools registry + icon set (A8 PR1, absorbs A6 data-driven nav)"
```

---

### Task 2: Sidebar preference helper + combined anti-FOUC script

**Files:**
- Create: `lib/shell/sidebar-pref.ts`
- Test: `lib/shell/sidebar-pref.test.ts`
- Modify: `app/layout.tsx:43` (anti-FOUC script only — nothing else in this task)

**Interfaces:**
- Produces: `readSidebarPref(raw: string | null): 'collapsed' | 'expanded'`, `SIDEBAR_STORAGE_KEY = 'er-sidebar'` — consumed by Task 3's hook and the layout script.

- [ ] **Step 1: Write the failing test**

```ts
// lib/shell/sidebar-pref.test.ts
import { describe, it, expect } from 'vitest'
import { readSidebarPref, SIDEBAR_STORAGE_KEY } from './sidebar-pref'

describe('readSidebarPref', () => {
  it('only the literal "collapsed" collapses; everything else expands', () => {
    expect(readSidebarPref('collapsed')).toBe('collapsed')
    expect(readSidebarPref('expanded')).toBe('expanded')
    expect(readSidebarPref(null)).toBe('expanded')
    expect(readSidebarPref('')).toBe('expanded')
    expect(readSidebarPref('true')).toBe('expanded')
    expect(readSidebarPref('COLLAPSED')).toBe('expanded')
  })
  it('storage key is stable', () => {
    expect(SIDEBAR_STORAGE_KEY).toBe('er-sidebar')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/shell/sidebar-pref.test.ts`
Expected: FAIL — `Cannot find module './sidebar-pref'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/shell/sidebar-pref.ts
// Client-safe. Validation mirrors the pre-hydration script in app/layout.tsx —
// keep the two in sync (Codex fix 3: only the literal 'collapsed' is honored).
export const SIDEBAR_STORAGE_KEY = 'er-sidebar'

export type SidebarPref = 'collapsed' | 'expanded'

export function readSidebarPref(raw: string | null): SidebarPref {
  return raw === 'collapsed' ? 'collapsed' : 'expanded'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/shell/sidebar-pref.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Extend the anti-FOUC script in `app/layout.tsx`**

Replace the existing script at line 43 with the combined theme + sidebar stamp (theme logic byte-identical; adds only the `data-sidebar` stamp):

```tsx
        {/* Anti-FOUC: apply saved theme + sidebar state before first paint */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('er-theme');var p=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';if((t||p)==='dark')document.documentElement.classList.add('dark');if(localStorage.getItem('er-sidebar')==='collapsed')document.documentElement.setAttribute('data-sidebar','collapsed');}catch(e){}})();` }} />
```

- [ ] **Step 6: Run full gates for the touched surface**

Run: `npx tsc --noEmit && npx vitest run lib/shell/`
Expected: clean · PASS

- [ ] **Step 7: Commit**

```bash
git add lib/shell/sidebar-pref.ts lib/shell/sidebar-pref.test.ts app/layout.tsx
git commit -m "feat(shell): sidebar collapse pref + combined anti-FOUC stamp"
```

---

### Task 3: SidebarNav component

**Files:**
- Create: `components/shell/SidebarNav.tsx`
- Test: `components/shell/SidebarNav.test.tsx`

**Interfaces:**
- Consumes: `TOOLS`, `NAV_GROUPS` (Task 1); `IconChevron` (Task 1).
- Produces: `SidebarNav({ collapsed, onToggleCollapse, onNavigate }: { collapsed: boolean; onToggleCollapse: () => void; onNavigate?: () => void })` — consumed by Task 5's `AppShell`. `onNavigate` fires on any link click (drawer close hook).

- [ ] **Step 1: Write the failing test**

```tsx
// components/shell/SidebarNav.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SidebarNav } from './SidebarNav'

// Active-state detection uses usePathname
const pathnameMock = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathnameMock.value }))

afterEach(cleanup)

const noop = () => {}

describe('SidebarNav', () => {
  it('renders every group label and tool name when expanded', () => {
    pathnameMock.value = '/'
    render(<SidebarNav collapsed={false} onToggleCollapse={noop} />)
    for (const label of ['Overview', 'Run', 'Plan', 'Reference']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByText('Site Audits')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('marks the active tool via aria-current and shows its children', () => {
    pathnameMock.value = '/ada-audit/queue'
    render(<SidebarNav collapsed={false} onToggleCollapse={noop} />)
    const active = screen.getByText('Site Audits').closest('a')!
    expect(active.getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('Audit queue')).toBeTruthy() // sub-links visible for active tool
    expect(screen.queryByText('Compare crawls')).toBeNull() // inactive tool's children hidden
  })

  it('collapsed mode hides text labels but keeps links with accessible names', () => {
    pathnameMock.value = '/'
    render(<SidebarNav collapsed onToggleCollapse={noop} />)
    expect(screen.queryByText('Overview')).toBeNull()
    expect(screen.getByLabelText('Site Audits')).toBeTruthy()
    expect(screen.queryByText('Audit queue')).toBeNull() // no sub-links when collapsed
  })

  it('fires onNavigate when a link is clicked and onToggleCollapse from the collapse button', () => {
    pathnameMock.value = '/'
    const onNavigate = vi.fn()
    const onToggle = vi.fn()
    render(<SidebarNav collapsed={false} onToggleCollapse={onToggle} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('SEO Parser'))
    expect(onNavigate).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/shell/SidebarNav.test.tsx`
Expected: FAIL — `Cannot find module './SidebarNav'`

- [ ] **Step 3: Write the component**

```tsx
// components/shell/SidebarNav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_GROUPS, TOOLS, toolForPathname, type ToolDef } from '@/lib/tools-registry'
import { IconChevron } from './icons'

interface SidebarNavProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onNavigate?: () => void
}

function NavItem({ tool, active, collapsed, showChildren, pathname, onNavigate }: {
  tool: ToolDef; active: boolean; collapsed: boolean; showChildren: boolean
  pathname: string; onNavigate?: () => void
}) {
  const Icon = tool.icon
  return (
    <div>
      <Link
        href={tool.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? tool.name : undefined}
        title={collapsed ? tool.name : undefined}
        className={`relative flex items-center gap-3 rounded-lg text-[13.5px] font-body transition-colors
          ${collapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2'}
          ${active
            ? 'bg-orange-subtle text-white font-semibold before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r before:bg-orange'
            : 'text-white/60 hover:bg-white/5 hover:text-white'}`}
      >
        <Icon className="w-[17px] h-[17px] shrink-0 opacity-85" />
        {!collapsed && <span className="truncate">{tool.name}</span>}
      </Link>
      {showChildren && (
        <div className="mt-0.5 mb-1 ml-[26px] flex flex-col gap-0.5 border-l border-white/10 pl-3">
          {tool.children!.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              onClick={onNavigate}
              className={`rounded px-2 py-1 text-[12.5px] transition-colors
                ${pathname === c.href ? 'text-white font-semibold' : 'text-white/50 hover:text-white'}`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function SidebarNav({ collapsed, onToggleCollapse, onNavigate }: SidebarNavProps) {
  const pathname = usePathname()
  const activeTool = toolForPathname(pathname)
  const footerTools = TOOLS.filter((t) => t.group === 'footer')

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-navy-deep to-navy text-white/80">
      <div className={`flex items-center gap-2.5 px-4 pt-[18px] pb-4 ${collapsed ? 'justify-center px-0' : ''}`}>
        <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-orange font-display text-[15px] font-extrabold text-navy-deep shadow-[0_2px_8px_rgba(245,166,35,0.35)]">
          ER
        </div>
        {!collapsed && (
          <div className="whitespace-nowrap font-display text-[15px] font-bold text-white">
            SEO Tools
            <span className="block font-body text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/40">
              Enrollment Resources
            </span>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        {NAV_GROUPS.map((group) => {
          const tools = TOOLS.filter((t) => t.group === group.id)
          if (tools.length === 0) return null
          return (
            <div key={group.id}>
              {!collapsed && (
                <div className="px-2.5 pb-1 pt-3.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
                  {group.label}
                </div>
              )}
              {collapsed && <div className="h-2.5" />}
              {tools.map((tool) => (
                <NavItem
                  key={tool.id}
                  tool={tool}
                  active={activeTool?.id === tool.id}
                  collapsed={collapsed}
                  showChildren={!collapsed && activeTool?.id === tool.id && !!tool.children?.length}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )
        })}
      </nav>

      <div className="border-t border-white/10 px-3 pb-3.5 pt-2.5">
        {footerTools.map((tool) => (
          <NavItem
            key={tool.id}
            tool={tool}
            active={activeTool?.id === tool.id}
            collapsed={collapsed}
            showChildren={false}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Collapse sidebar"
          className={`mt-1 flex w-full items-center gap-3 rounded-lg py-2 text-[13px] text-white/50 transition-colors hover:bg-white/5 hover:text-white ${collapsed ? 'justify-center px-0' : 'px-2.5'}`}
        >
          <IconChevron className={`h-4 w-4 shrink-0 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/shell/SidebarNav.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/shell/SidebarNav.tsx components/shell/SidebarNav.test.tsx
git commit -m "feat(shell): SidebarNav — registry-driven, collapsible, active notch"
```

---

### Task 4: Topbar with logout

**Files:**
- Create: `components/shell/Topbar.tsx`
- Test: `components/shell/Topbar.test.tsx`

**Interfaces:**
- Consumes: `toolForPathname` (Task 1), `ThemeToggle` (existing `components/ThemeToggle.tsx`), `IconMenu`, `IconLogout` (Task 1).
- Produces: `Topbar({ onMenuClick }: { onMenuClick: () => void })` — consumed by Task 5. Renders the mobile hamburger (hidden ≥ md).

- [ ] **Step 1: Write the failing test**

```tsx
// components/shell/Topbar.test.tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Topbar } from './Topbar'

const pathnameMock = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathnameMock.value }))
// ThemeToggle reads ThemeProvider context; stub it — its behavior is tested elsewhere.
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => <div data-testid="theme-toggle" /> }))

afterEach(cleanup)

describe('Topbar', () => {
  it('shows the active tool name as the page title', () => {
    pathnameMock.value = '/seo-parser/diff'
    render(<Topbar onMenuClick={() => {}} />)
    expect(screen.getByRole('heading', { name: 'SEO Parser' })).toBeTruthy()
  })

  it('falls back to Home on the root path', () => {
    pathnameMock.value = '/'
    render(<Topbar onMenuClick={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy()
  })

  it('preserves the logout affordance as a plain form POST (Codex fix 6)', () => {
    pathnameMock.value = '/'
    render(<Topbar onMenuClick={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Log out' })
    const form = btn.closest('form')!
    expect(form.getAttribute('action')).toBe('/api/auth/logout')
    expect(form.getAttribute('method')).toBe('post')
  })

  it('renders the theme toggle and the mobile menu button', () => {
    pathnameMock.value = '/'
    render(<Topbar onMenuClick={() => {}} />)
    expect(screen.getByTestId('theme-toggle')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open navigation menu' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/shell/Topbar.test.tsx`
Expected: FAIL — `Cannot find module './Topbar'`

- [ ] **Step 3: Write the component**

```tsx
// components/shell/Topbar.tsx
'use client'

import { usePathname } from 'next/navigation'
import { toolForPathname } from '@/lib/tools-registry'
import { ThemeToggle } from '@/components/ThemeToggle'
import { IconLogout, IconMenu } from './icons'

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname()
  const title = toolForPathname(pathname)?.name ?? 'Home'

  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-gray-200 bg-white/75 px-5 py-3 backdrop-blur-md dark:border-navy-border dark:bg-navy-deep/75 md:px-8">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open navigation menu"
        className="-ml-1 rounded-md p-2 text-navy/70 hover:bg-gray-100 dark:text-white/70 dark:hover:bg-white/5 md:hidden"
      >
        <IconMenu className="h-5 w-5" />
      </button>

      <h1 className="font-display text-base font-bold tracking-[0.01em] text-navy dark:text-white">{title}</h1>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            aria-label="Log out"
            title="Log out"
            className="rounded-md p-2 text-navy/60 transition-colors hover:bg-gray-100 hover:text-navy dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <IconLogout className="h-4 w-4" />
          </button>
        </form>
      </div>
    </header>
  )
}
```

Note: the "+ New scan" CTA and ⌘K affordance from the mockup arrive with the
dashboard (PR 2) where their destinations exist — YAGNI here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/shell/Topbar.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/shell/Topbar.tsx components/shell/Topbar.test.tsx
git commit -m "feat(shell): Topbar — registry title, theme toggle, form-POST logout"
```

---

### Task 5: AppShell assembly (desktop rail + mobile drawer)

**Files:**
- Create: `components/shell/AppShell.tsx`
- Test: `components/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `SidebarNav` (Task 3), `Topbar` (Task 4), `readSidebarPref`/`SIDEBAR_STORAGE_KEY` (Task 2).
- Produces: `AppShell({ children }: { children: React.ReactNode })` — consumed by Task 6's `(app)/layout.tsx`. Owns collapse + drawer state.

- [ ] **Step 1: Write the failing test**

```tsx
// components/shell/AppShell.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { AppShell } from './AppShell'

const pathnameMock = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathnameMock.value }))
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => <div data-testid="theme-toggle" /> }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.removeAttribute('data-sidebar')
})
beforeEach(() => { pathnameMock.value = '/' })

describe('AppShell', () => {
  it('renders children inside main', () => {
    render(<AppShell><p>page body</p></AppShell>)
    expect(screen.getByText('page body').closest('main')).toBeTruthy()
  })

  it('initial collapse comes from the pre-hydration html attribute', () => {
    document.documentElement.setAttribute('data-sidebar', 'collapsed')
    render(<AppShell><p>x</p></AppShell>)
    // collapsed sidebar renders icon-only links (aria-label present, no visible text)
    expect(screen.getByLabelText('Site Audits')).toBeTruthy()
  })

  it('toggling collapse persists to localStorage and stamps the html attribute', () => {
    render(<AppShell><p>x</p></AppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(localStorage.getItem('er-sidebar')).toBe('collapsed')
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('collapsed')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(localStorage.getItem('er-sidebar')).toBe('expanded')
    expect(document.documentElement.getAttribute('data-sidebar')).toBeNull()
  })

  it('mobile drawer opens from the topbar menu button and closes on navigation', () => {
    render(<AppShell><p>x</p></AppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    const drawer = screen.getByRole('dialog', { name: 'Navigation' })
    expect(drawer).toBeTruthy()
    // clicking a nav link inside the drawer closes it
    fireEvent.click(screen.getAllByText('SEO Parser')[1] ?? screen.getAllByText('SEO Parser')[0])
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/shell/AppShell.test.tsx`
Expected: FAIL — `Cannot find module './AppShell'`

- [ ] **Step 3: Write the component**

```tsx
// components/shell/AppShell.tsx
'use client'

import { useEffect, useState } from 'react'
import { SidebarNav } from './SidebarNav'
import { Topbar } from './Topbar'
import { SIDEBAR_STORAGE_KEY } from '@/lib/shell/sidebar-pref'

export function AppShell({ children }: { children: React.ReactNode }) {
  // Initial value comes from the pre-hydration stamp so server + first client
  // render agree (Codex fix 3); localStorage is only read by the layout script.
  const [collapsed, setCollapsed] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-sidebar') === 'collapsed',
  )
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? 'collapsed' : 'expanded')
      } catch {}
      if (next) document.documentElement.setAttribute('data-sidebar', 'collapsed')
      else document.documentElement.removeAttribute('data-sidebar')
      return next
    })
  }

  // Body scroll lock while the mobile drawer is open (spec §3.2 mobile)
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 overflow-hidden transition-[width] duration-200 md:block ${collapsed ? 'w-[68px]' : 'w-[248px]'}`}
      >
        <SidebarNav collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div role="dialog" aria-modal="true" aria-label="Navigation" className="absolute inset-y-0 left-0 w-[280px] shadow-2xl">
            <SidebarNav
              collapsed={false}
              onToggleCollapse={() => setDrawerOpen(false)}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col bg-[#f4f6f9] dark:bg-navy-deep">
        <Topbar onMenuClick={() => setDrawerOpen(true)} />
        <main id="main-content" className="flex-1">{children}</main>
      </div>
    </div>
  )
}
```

Note: the component intentionally reads the DOM attribute (not localStorage)
for its initial state — the pre-hydration script already validated the stored
value. `readSidebarPref` (Task 2) stays the single validator mirrored by that
script; it is deliberately NOT imported here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/shell/AppShell.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/shell/AppShell.tsx components/shell/AppShell.test.tsx
git commit -m "feat(shell): AppShell — desktop rail + mobile drawer + collapse persistence"
```

---

### Task 6: Route-group split, root-layout slimming, old nav deletion

**Files:**
- Create: `app/(app)/layout.tsx`, `app/(public)/layout.tsx`
- Modify: `app/layout.tsx` (remove Nav/Footer/main wrapper)
- Move (`git mv`): every page dir per the table below
- Delete: `components/nav.tsx`
- Test: `app/route-groups.test.ts`

**Interfaces:**
- Consumes: `AppShell` (Task 5), existing `Footer` (`components/footer.tsx`), `isPublicPath` (`middleware.ts`).

- [ ] **Step 1: Write the failing drift test**

```ts
// app/route-groups.test.ts
// Codex fix 1: the (public)/(app) split must track middleware's isPublicPath.
// Walks the app dir: every page.tsx under (public) must resolve to a public
// URL; every page.tsx under (app) must NOT.
import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { isPublicPath } from '@/middleware'

function pagesUnder(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // dynamic segments become a representative literal so isPublicPath can judge the prefix
      const seg = entry.startsWith('[') ? 'x' : entry
      out.push(...pagesUnder(full, `${base}/${seg}`))
    } else if (entry === 'page.tsx') {
      out.push(base === '' ? '/' : base)
    }
  }
  return out
}

describe('route-group split tracks isPublicPath', () => {
  it('every (public) page is public', () => {
    for (const url of pagesUnder('app/(public)')) {
      // trailing-slash variant covers prefix rules like '/share/'
      expect(isPublicPath(url) || isPublicPath(url + '/'), url).toBe(true)
    }
  })
  it('no (app) page is public', () => {
    for (const url of pagesUnder('app/(app)')) {
      expect(isPublicPath(url), url).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/route-groups.test.ts`
Expected: FAIL — `ENOENT ... app/(public)` (groups don't exist yet)

- [ ] **Step 3: Move page directories with `git mv`**

```bash
mkdir 'app/(app)' 'app/(public)'
# public pages
git mv app/login 'app/(public)/login'
git mv app/about 'app/(public)/about'
git mv app/privacy 'app/(public)/privacy'
git mv app/share 'app/(public)/share'
# gated pages
for d in admin ada-audit clients eat-checklist keyword-research oxygen-tailwind-guide \
         pillar-analysis quarter-grid rankmath-redirects reports robots-validator \
         seo-parser settings; do
  git mv "app/$d" "app/(app)/$d"
done
git mv app/page.tsx 'app/(app)/page.tsx'
# ada-audit's PUBLIC share subtrees move to (public), preserving URLs
mkdir -p 'app/(public)/ada-audit/site'
git mv 'app/(app)/ada-audit/share' 'app/(public)/ada-audit/share'
git mv 'app/(app)/ada-audit/site/share' 'app/(public)/ada-audit/site/share'
```

`app/api/`, `app/globals.css`, `app/icon.tsx`, `app/layout.tsx` stay at the root.

- [ ] **Step 4: Write the two group layouts**

```tsx
// app/(app)/layout.tsx
import { AppShell } from '@/components/shell/AppShell'

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
```

```tsx
// app/(public)/layout.tsx
// Public pages (login, share views, about, privacy): no app chrome
// (Codex fix 1), Footer lives here only (Codex fix 2).
import Footer from '@/components/footer'

export default function PublicGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <main id="main-content" className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
```

- [ ] **Step 5: Slim the root layout**

In `app/layout.tsx`: delete the `Nav` and `Footer` imports (lines 4–5) and replace the body contents (lines 45–56) with:

```tsx
      <body className="min-h-screen bg-white dark:bg-navy-deep text-navy dark:text-white antialiased">
        <ThemeProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[#1c2d4a] focus:text-white focus:rounded-lg focus:text-sm focus:font-semibold"
          >
            Skip to main content
          </a>
          {children}
        </ThemeProvider>
      </body>
```

(The `flex flex-col` + `<main>` wrapper moves into the group layouts; the skip
link stays global — both group layouts render an `id="main-content"` main.)

- [ ] **Step 6: Delete the old nav**

```bash
git rm components/nav.tsx
grep -rn "components/nav" app components lib --include='*.ts*'
```

Expected grep: no matches (fix any stragglers by removing the import/usage).

- [ ] **Step 7: Run the drift test + full gates**

Run: `npx vitest run app/route-groups.test.ts` — Expected: PASS (2 tests)
Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc clean · full suite green · build succeeds with the SAME route
URLs as before (route groups are URL-invisible — verify `/login`,
`/ada-audit/share/[token]`, `/ada-audit/site/share/[token]`, and `/` all
appear unchanged in the build's route table output).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(shell): (app)/(public) route groups, mount AppShell, delete top nav

Public share/login/about/privacy pages render chrome-less with Footer;
all gated pages get the sidebar shell. Root layout slimmed to
providers + skip link. Drift test pins route-group membership to
middleware isPublicPath."
```

---

### Task 7: Sticky-offset audit + visual/gate finish

**Files:**
- Modify: `app/(app)/oxygen-tailwind-guide/_components/sidebar.tsx:47`
- Modify: `app/(app)/pillar-analysis/[id]/components/SectionNav.tsx:21`

**Interfaces:** none produced; consumes the shell from Task 6 (topbar is `sticky top-0`, ~57px tall: `py-3` + border + 16px-base content).

- [ ] **Step 1: Repo-wide offset scan (Codex fix 7)**

```bash
grep -rn 'top-\[' app components --include='*.tsx'
```

Expected: exactly the two known sites (values `top-[80px]`, `top-[60px]`,
plus `max-h-[calc(100vh-100px)]` on the first). If new ones appeared since
the plan was written, fix them by the same rule below.

- [ ] **Step 2: Fix both offsets to sit under the new 57px topbar**

`app/(app)/oxygen-tailwind-guide/_components/sidebar.tsx:47` — change
`sticky top-[80px] max-h-[calc(100vh-100px)]` to
`sticky top-[73px] max-h-[calc(100vh-90px)]`.

`app/(app)/pillar-analysis/[id]/components/SectionNav.tsx:21` — change
`sticky top-[60px]` to `sticky top-[57px]` (flush under the topbar).

- [ ] **Step 3: Run gates**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 4: Manual visual pass (dev server)**

Run: `npm run dev` and eyeball:
- `/` — sidebar visible, Home active, homepage content unchanged inside shell
- `/ada-audit` → `/ada-audit/queue` — Site Audits active, sub-links shown, queue page sticky elements sane
- collapse → reload — rail stays collapsed with no flash (anti-FOUC stamp)
- `/login` (logged out) + an existing `/ada-audit/site/share/<token>` URL — NO sidebar, Footer present
- narrow viewport — hamburger opens drawer, link click closes it
- dark + light theme on all of the above
- `/oxygen-tailwind-guide` + a pillar-analysis page — sticky sidebars sit under the topbar

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(shell): retune sticky offsets for the new topbar height"
```

---

## Verification (whole PR)

1. `npx tsc --noEmit` — clean.
2. `npx vitest run` — full suite green (new tests: registry ×4, sidebar-pref ×2, SidebarNav ×4, Topbar ×4, AppShell ×4, route-groups ×2 = +20).
3. `npm run build` — succeeds; route URL set unchanged.
4. Manual pass per Task 7 Step 4.
5. PR via the normal flow (branch → PR → review); deploy is plain `~/deploy.sh` (no migration, no env change).
