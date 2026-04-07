'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { ThemeToggle } from './ThemeToggle'

interface DropdownItem {
  name: string
  href: string
  description?: string
}

interface NavTool {
  name: string
  href: string
  dropdown?: DropdownItem[]
}

const tools: NavTool[] = [
  {
    name: 'SEO Parser',
    href: '/seo-parser',
    dropdown: [
      { name: 'All Sessions', href: '/seo-parser', description: 'Upload and analyze' },
      { name: 'Compare Crawls', href: '/seo-parser/diff' },
    ],
  },
  { name: 'Quarter Grid', href: '/quarter-grid' },
  { name: 'RankMath Redirects', href: '/rankmath-redirects' },
  { name: 'Robots Validator', href: '/robots-validator' },
  { name: 'ADA Audit', href: '/ada-audit' },
  { name: 'Clients', href: '/clients' },
]

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

export default function Nav() {
  const pathname = usePathname()
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleClose() {
    closeTimer.current = setTimeout(() => setOpenDropdown(null), 150)
  }

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  // Close dropdown on outside click or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenDropdown(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // Clean up close timer on unmount
  useEffect(() => {
    return () => { if (closeTimer.current) clearTimeout(closeTimer.current) }
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false)
    setOpenDropdown(null)
  }, [pathname])

  function isActive(href: string) {
    return href === '/' ? pathname === '/' : pathname.startsWith(href)
  }

  return (
    <nav className="bg-navy text-white sticky top-0 z-50 shadow-md border-b border-navy-light/30">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-[60px]">

          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2.5 group flex-shrink-0"
          >
            <div className="w-8 h-8 bg-orange rounded flex items-center justify-center group-hover:bg-orange-light transition-colors duration-150">
              <span className="font-display font-extrabold text-navy text-[13px] leading-none tracking-tight">ER</span>
            </div>
            <div>
              <div className="font-display font-bold text-[15px] leading-tight text-white">
                SEO Tools
              </div>
              <div className="text-white/60 text-[9px] leading-tight tracking-[0.15em] uppercase">
                Enrollment Resources
              </div>
            </div>
          </Link>

          {/* Desktop nav */}
          <div ref={dropdownRef} className="hidden md:flex items-center gap-0.5">
            {tools.map((tool) => {
              const active = isActive(tool.href)

              if (tool.dropdown) {
                return (
                  <div key={tool.href} className="relative">
                    <Link
                      href={tool.href}
                      aria-haspopup="true"
                      aria-expanded={openDropdown === tool.name}
                      onMouseEnter={() => { cancelClose(); setOpenDropdown(tool.name) }}
                      onMouseLeave={scheduleClose}
                      onFocus={() => { cancelClose(); setOpenDropdown(tool.name) }}
                      onBlur={scheduleClose}
                      className={`flex items-center gap-1.5 px-4 py-2 text-[14px] font-body rounded-md transition-colors duration-150 ${
                        active
                          ? 'text-orange'
                          : 'text-white/70 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {tool.name}
                      <ChevronIcon
                        className={`w-3 h-3 transition-transform duration-150 ${
                          openDropdown === tool.name ? 'rotate-180' : ''
                        }`}
                      />
                    </Link>

                    {/* Dropdown */}
                    {openDropdown === tool.name && (
                      <div
                        className="nav-dropdown absolute top-full left-0 w-48"
                        onMouseEnter={cancelClose}
                        onMouseLeave={scheduleClose}
                        onFocus={cancelClose}
                        onBlur={scheduleClose}
                      >
                        <div className="bg-navy-deep border border-navy-border rounded-lg shadow-2xl py-1.5 overflow-hidden">
                          {tool.dropdown.map((item, i) => (
                            <div key={item.href}>
                              {i === 1 && (
                                <div className="mx-3 my-1 border-t border-white/10" />
                              )}
                              <Link
                                href={item.href}
                                className={`flex items-center gap-2 px-3.5 py-2 text-[13px] transition-colors duration-100 ${
                                  pathname === item.href
                                    ? 'text-orange bg-orange-subtle'
                                    : 'text-white/65 hover:text-white hover:bg-white/5'
                                }`}
                              >
                                {i === 0 ? (
                                  <>
                                    <span className="font-body">{item.name}</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="w-4 h-4 rounded-sm bg-orange/20 flex items-center justify-center text-orange text-[9px] font-bold flex-shrink-0">
                                      {i}
                                    </span>
                                    <span className="font-body">{item.name}</span>
                                  </>
                                )}
                              </Link>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <Link
                  key={tool.href}
                  href={tool.href}
                  className={`px-4 py-2 text-[14px] font-body rounded-md transition-colors duration-150 ${
                    active
                      ? 'text-orange'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {tool.name}
                </Link>
              )
            })}
          </div>

          {/* Theme toggle + mobile menu toggle */}
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 text-white/70 hover:text-white rounded-md hover:bg-white/5 transition-colors"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-navy-light/30 bg-navy-deep">
          <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col gap-1">
            {tools.map((tool) => (
              <div key={tool.href}>
                <Link
                  href={tool.href}
                  className={`block px-3 py-2.5 text-[14px] font-body rounded-md transition-colors ${
                    isActive(tool.href)
                      ? 'text-orange bg-orange-subtle'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {tool.name}
                </Link>
                {tool.dropdown && (
                  <div className="ml-4 mt-0.5 flex flex-col gap-0.5">
                    {tool.dropdown.slice(1).map((item, i) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`block px-3 py-2 text-[13px] font-body rounded-md transition-colors ${
                          pathname === item.href
                            ? 'text-orange'
                            : 'text-white/65 hover:text-white'
                        }`}
                      >
                        V{i + 1}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </nav>
  )
}
