// components/shell/AppShell.tsx
'use client'

import { useEffect, useState } from 'react'
import { SidebarNav } from './SidebarNav'
import { Topbar } from './Topbar'
import { SIDEBAR_STORAGE_KEY } from '@/lib/shell/sidebar-pref'

export function AppShell({ children }: { children: React.ReactNode }) {
  // Hydration safety (Codex plan-fix 1): server HTML and the FIRST client
  // render must be identical, so React state starts 'expanded' on both. The
  // pre-paint WIDTH on a collapsed reload is handled purely in CSS via the
  // html[data-sidebar="collapsed"] stamp (see the aside's arbitrary variant);
  // labels inside the 68px overflow-hidden rail are clipped, so the post-mount
  // state sync below flips them without any visible flash.
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    setCollapsed(document.documentElement.getAttribute('data-sidebar') === 'collapsed')
  }, [])

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

  // Escape closes the drawer
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // Auto-close the drawer if the viewport reaches the desktop breakpoint, so
  // it can't be left open across a resize with both navs mounted + the
  // scroll-lock stuck. Guard matchMedia — jsdom doesn't implement it.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => { if (mq.matches) setDrawerOpen(false) }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — width is CSS-driven off the html attribute so a
          collapsed reload paints at 68px BEFORE hydration (no flash, no
          hydration mismatch); React state only re-renders labels/tooltips. */}
      <aside
        className="sticky top-0 hidden h-screen w-[248px] shrink-0 overflow-hidden transition-[width] duration-200 md:block [html[data-sidebar=collapsed]_&]:w-[68px]"
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
              onToggleCollapse={() => {}}
              onNavigate={() => setDrawerOpen(false)}
              showCollapseControl={false}
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
