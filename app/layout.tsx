import type { Metadata } from 'next'
import { Barlow, Source_Sans_3 } from 'next/font/google'
import './globals.css'
import Nav from '@/components/nav'
import Footer from '@/components/footer'

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-barlow',
  display: 'swap',
})

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '600'],
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
    <html lang="en" className={`${barlow.variable} ${sourceSans.variable}`}>
      <body className="min-h-screen flex flex-col bg-white text-navy antialiased">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
