import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'

// Self-hosted (latin subset) instead of next/font/google so `next build` needs
// no outbound network — Google Fonts fetch-at-build broke every offline build
// (Codex sandbox + any airgapped build). Files under app/fonts/ are the latin
// gstatic subsets for exactly the weights used below.
const barlow = localFont({
  src: [
    { path: './fonts/barlow-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/barlow-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/barlow-700.woff2', weight: '700', style: 'normal' },
    { path: './fonts/barlow-800.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-barlow',
  display: 'swap',
})

const sourceSans = localFont({
  src: [
    { path: './fonts/source-sans-3-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/source-sans-3-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-source-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'ER SEO Tools',
    template: '%s — ER SEO Tools',
  },
  description: 'Purpose-built SEO tools for the Enrollment Resources team.',
  robots: {
    index: false,
    follow: false,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`scroll-smooth ${barlow.variable} ${sourceSans.variable}`} suppressHydrationWarning>
      <head>
        {/* Anti-FOUC: apply saved theme + sidebar state before first paint */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('er-theme');var p=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';if((t||p)==='dark')document.documentElement.classList.add('dark');if(localStorage.getItem('er-sidebar')==='collapsed')document.documentElement.setAttribute('data-sidebar','collapsed');}catch(e){}})();` }} />
      </head>
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
    </html>
  )
}
