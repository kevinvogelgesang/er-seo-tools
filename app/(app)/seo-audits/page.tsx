import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME, getAuthSession } from '@/lib/auth';
import { SeoAuditTabs } from '@/components/seo-parser/SeoAuditTabs';
import { HistoryList } from '@/components/seo-parser/HistoryList';

export const metadata = { title: 'SEO Audits — ER SEO Tools' };
export const dynamic = 'force-dynamic';

export default async function SeoAuditsPage() {
  const c = await cookies();
  // D7: only offer the notify checkbox when a verified session email exists.
  const notifyAvailable = Boolean((await getAuthSession(c.get(AUTH_COOKIE_NAME)?.value))?.email);
  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="font-display font-bold text-[28px] text-navy dark:text-white">SEO Audits</h1>
        <p className="text-[14px] font-body text-navy/60 dark:text-white/60 mt-1">
          Scan a URL for on-page SEO, or upload Screaming Frog CSV exports for a prioritized report.
        </p>
      </div>
      <SeoAuditTabs notifyAvailable={notifyAvailable} />
      <HistoryList />
    </main>
  );
}
