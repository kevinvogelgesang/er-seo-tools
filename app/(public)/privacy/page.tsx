import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How ER SEO Tools accesses, uses, stores, and protects data — including data accessed through Google APIs.',
}

const EFFECTIVE_DATE = 'June 22, 2026'
const CONTACT_EMAIL = 'kevin@enrollmentresources.com'

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-gray-800 dark:text-white/90">
      <h1 className="font-display text-3xl font-bold text-navy dark:text-white">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-white/60">
        Effective date: {EFFECTIVE_DATE}
      </p>

      <p className="mt-6 leading-relaxed">
        ER SEO Tools (&ldquo;the App&rdquo;) is an internal application operated by
        Enrollment Resources (&ldquo;we,&rdquo; &ldquo;us&rdquo;) to produce
        search-engine-optimization (SEO) performance reports for our clients. This
        policy explains what information the App accesses, how it is used, and how it
        is protected — with specific attention to data accessed through Google APIs.
      </p>

      <Section title="1. Who this applies to">
        The App is a private, internal business tool used by authorized Enrollment
        Resources staff. It is not a consumer product and is not marketed to the
        general public.
      </Section>

      <Section title="2. Information we access through Google">
        <p>
          With authorization from the relevant account owner, the App connects to a
          single Enrollment Resources Google account that has been granted access to
          our clients&rsquo; Google properties, and reads — on a strictly read-only
          basis — the following:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-6">
          <li>
            <strong>Google Analytics 4 (GA4)</strong> data via the Google Analytics
            Data API and Google Analytics Admin API (for example: sessions,
            engagement, conversions/key events, and traffic broken down by page,
            location, and device).
          </li>
          <li>
            <strong>Google Search Console</strong> data via the Search Console API
            (for example: clicks, impressions, click-through rate, average position,
            and search queries).
          </li>
        </ul>
        <p className="mt-3">
          We request read-only scopes only (<code>analytics.readonly</code> and{' '}
          <code>webmasters.readonly</code>), plus basic profile email
          (<code>openid</code>, <code>email</code>) solely to display which Google
          account is connected.
        </p>
      </Section>

      <Section title="3. How we use this information">
        Google Analytics and Search Console data is used solely to generate periodic
        SEO performance reports for the client to whom the data belongs. We do not use
        it for advertising, we do not sell it, and we do not use it to build profiles
        for any purpose unrelated to those reports.
      </Section>

      <Section title="4. Google API Services Limited Use disclosure">
        ER SEO Tools&rsquo; use and transfer of information received from Google APIs
        to any other app will adhere to the{' '}
        <a
          className="text-orange underline"
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </Section>

      <Section title="5. How we share information">
        We do not share Google user data with third parties. Reports derived from a
        client&rsquo;s data are provided only to that client and to authorized
        Enrollment Resources staff. We do not transfer Google user data except as
        necessary to provide the reporting service, to comply with applicable law, or
        in connection with a merger or acquisition (in which case this policy
        continues to govern the data).
      </Section>

      <Section title="6. Storage and security">
        <ul className="list-disc space-y-1 pl-6">
          <li>
            OAuth refresh tokens are encrypted at rest (AES-256-GCM) and are never
            exposed to the browser or written to logs.
          </li>
          <li>
            The App is hosted on a private server, protected by authentication, and
            accessible only to authorized Enrollment Resources staff.
          </li>
          <li>
            Analytics and Search Console data is stored only as needed to render and
            retain generated reports.
          </li>
        </ul>
      </Section>

      <Section title="7. Data retention">
        Generated reports and their underlying metric snapshots are retained for up to
        24 months for scheduled reports and for a shorter period for ad-hoc reports,
        after which they are automatically deleted. OAuth authorization is retained
        until it is revoked (see below).
      </Section>

      <Section title="8. Revoking access and deleting data">
        The connected Google account owner may revoke the App&rsquo;s access at any
        time at{' '}
        <a
          className="text-orange underline"
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noopener noreferrer"
        >
          myaccount.google.com/permissions
        </a>
        . To request deletion of stored data or reports, contact us at the address
        below and we will delete it.
      </Section>

      <Section title="9. Other (non-Google) data">
        The App also processes website crawl and audit data for our clients&rsquo; own
        websites (for example, technical SEO and accessibility findings). This data is
        generated by the App and is subject to the same access controls and retention
        practices described above.
      </Section>

      <Section title="10. Changes to this policy">
        We may update this policy from time to time. Material changes will be
        reflected by updating the effective date shown above.
      </Section>

      <Section title="11. Contact">
        Enrollment Resources —{' '}
        <a className="text-orange underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-semibold text-navy dark:text-white">
        {title}
      </h2>
      <div className="mt-2 leading-relaxed">{children}</div>
    </section>
  )
}
