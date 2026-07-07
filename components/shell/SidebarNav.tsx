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
  showCollapseControl?: boolean
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

export function SidebarNav({ collapsed, onToggleCollapse, onNavigate, showCollapseControl = true }: SidebarNavProps) {
  const pathname = usePathname()
  const activeTool = toolForPathname(pathname)
  const footerTools = TOOLS.filter((t) => t.group === 'footer' && !t.hidden)

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
          const tools = TOOLS.filter((t) => t.group === group.id && !t.hidden)
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
        {showCollapseControl && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            className={`mt-1 flex w-full items-center gap-3 rounded-lg py-2 text-[13px] text-white/50 transition-colors hover:bg-white/5 hover:text-white ${collapsed ? 'justify-center px-0' : 'px-2.5'}`}
          >
            <IconChevron className={`h-4 w-4 shrink-0 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} />
            {!collapsed && <span>Collapse</span>}
          </button>
        )}
      </div>
    </div>
  )
}
