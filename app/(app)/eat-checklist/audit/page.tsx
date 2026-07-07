import Link from 'next/link';

import { DashboardMarkdown } from '@/components/markdown/DashboardMarkdown';
import { AUDIT_CHECKLIST_MD } from '@/lib/eat-checklist/audit-checklist-content';

export const metadata = {
  title: 'E-E-A-T Audit Checklist',
  description:
    'The instrument task A1 runs: score each site against the E-E-A-T checklist, YMYL-critical issues first.',
};

export default function EatAuditChecklistPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6">
        <Link
          href="/eat-checklist"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-orange dark:text-gray-400 dark:hover:text-orange"
        >
          <span aria-hidden="true">&larr;</span>
          Back to the Scenario Selector
        </Link>
      </div>

      <article className="rounded-lg border border-gray-300 bg-white p-6 dark:border-navy-border dark:bg-navy-card sm:p-8">
        <DashboardMarkdown source={AUDIT_CHECKLIST_MD} />
      </article>
    </main>
  );
}
