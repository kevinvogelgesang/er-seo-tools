// Public pages (login, share views, about, privacy): no app chrome
// (Codex fix 1), Footer lives here only (Codex fix 2). The Footer is
// path-gated (PublicFooter) so it never renders on the prospect-facing
// /sales/[token] report.
import PublicFooter from '@/components/PublicFooter'

export default function PublicGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <main id="main-content" className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  )
}
