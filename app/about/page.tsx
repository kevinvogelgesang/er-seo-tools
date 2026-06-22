import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About',
  description:
    'ER SEO Tools is an internal application Enrollment Resources uses to monitor and report on the search performance of its clients’ websites.',
}

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-gray-800 dark:text-white/90">
      <h1 className="font-display text-3xl font-bold text-navy dark:text-white">
        About ER SEO Tools
      </h1>

      <p className="mt-6 leading-relaxed">
        <strong>ER SEO Tools</strong> is an internal web application operated by{' '}
        <strong>Enrollment Resources</strong>. We use it to monitor and report on the
        search-engine performance of our clients&rsquo; websites and to manage the
        SEO work we do on their behalf. It is a private, staff-only business tool — not
        a consumer product.
      </p>

      <h2 className="mt-8 font-display text-xl font-semibold text-navy dark:text-white">
        What the app does
      </h2>
      <ul className="mt-2 list-disc space-y-2 pl-6 leading-relaxed">
        <li>
          <strong>SEO performance reports.</strong> Generates branded, periodic
          reports for each client by combining Google Analytics 4 and Google Search
          Console data with period-over-period comparisons (sessions, engagement,
          conversions, clicks, impressions, average position, top pages and queries,
          and more).
        </li>
        <li>
          <strong>Technical SEO &amp; accessibility audits.</strong> Crawls client
          websites to surface on-page SEO issues and WCAG accessibility findings, with
          prioritized recommendations.
        </li>
        <li>
          <strong>Planning &amp; workflow.</strong> Tracks keyword research, content
          briefs, and quarterly SEO planning for our client engagements.
        </li>
      </ul>

      <h2 className="mt-8 font-display text-xl font-semibold text-navy dark:text-white">
        How the app uses Google data
      </h2>
      <p className="mt-2 leading-relaxed">
        With authorization from the account owner, the app connects to a single
        Enrollment Resources Google account and reads — strictly read-only — Google
        Analytics 4 and Google Search Console data for our clients&rsquo; properties.
        That data is used solely to produce the SEO performance reports described
        above. It is never sold, never used for advertising, and never shared beyond
        the client it belongs to and authorized Enrollment Resources staff. For full
        detail, see our{' '}
        <Link className="text-orange underline" href="/privacy">
          Privacy Policy
        </Link>
        .
      </p>

      <h2 className="mt-8 font-display text-xl font-semibold text-navy dark:text-white">
        Contact
      </h2>
      <p className="mt-2 leading-relaxed">
        Enrollment Resources —{' '}
        <a className="text-orange underline" href="mailto:kevin@enrollmentresources.com">
          kevin@enrollmentresources.com
        </a>
      </p>
    </main>
  )
}
