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
