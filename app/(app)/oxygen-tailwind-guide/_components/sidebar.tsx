'use client'

import { useEffect, useState } from 'react'

export interface SidebarSection {
  id: string
  label: string
  group?: string
}

export function Sidebar({ sections }: { sections: SidebarSection[] }) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '')

  useEffect(() => {
    if (typeof window === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        // pick the entry highest up that's intersecting
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActiveId(visible.target.id)
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: 0 }
    )

    sections.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [sections])

  // Group sections under their group label
  const grouped: { group: string; items: SidebarSection[] }[] = []
  for (const s of sections) {
    const g = s.group ?? ''
    const last = grouped[grouped.length - 1]
    if (last && last.group === g) last.items.push(s)
    else grouped.push({ group: g, items: [s] })
  }

  return (
    <aside className="hidden lg:block w-[230px] flex-shrink-0">
      <nav className="sticky top-[73px] max-h-[calc(100vh-90px)] overflow-y-auto pr-3 pb-12">
        {grouped.map((group, gi) => (
          <div key={gi} className="mb-6">
            {group.group && (
              <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-white/30 mb-2 pl-3">
                {group.group}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((s) => {
                const active = s.id === activeId
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={`block text-[13px] font-body py-1.5 pl-3 border-l-2 transition-colors duration-150 ${
                        active
                          ? 'border-orange text-orange font-semibold'
                          : 'border-navy-border text-white/55 hover:text-white hover:border-white/30'
                      }`}
                    >
                      {s.label}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
