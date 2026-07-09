import { permanentRedirect } from 'next/navigation'

// C16: the SEO Audits index folded into the merged "Audits" section. 308 via
// permanentRedirect() (NOT redirect(), which emits 307) — precedent: the
// /seo-parser → /seo-audits renames in next.config.ts. Only THIS index
// redirects; /seo-audits/results/*, share and /seo-audits/diff keep their
// URLs (memo/history links must not break).
export default function SeoAuditsIndexPage() {
  permanentRedirect('/ada-audit')
}
