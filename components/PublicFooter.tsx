'use client'
// The internal-tool Footer (tool nav + "not for external distribution") is
// fine on internal public pages (login/about/privacy) and audit share views,
// but must NOT appear on the prospect-facing sales report. Gate it by path.
import { usePathname } from 'next/navigation'
import Footer from '@/components/footer'

export default function PublicFooter() {
  const pathname = usePathname()
  if (pathname?.startsWith('/sales/')) return null
  return <Footer />
}
