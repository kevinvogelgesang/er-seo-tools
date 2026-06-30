import { cookies } from 'next/headers'
import { normalizeAuthReturnPath, OPERATOR_NAME_COOKIE_NAME, OPERATOR_NAME_MAX_LENGTH } from '@/lib/auth'
import { isGoogleOAuthConfigured } from '@/lib/auth/google-oauth'

interface Props {
  searchParams: Promise<{ next?: string; error?: string }>
}

export const metadata = {
  title: 'Login',
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: 'Invalid password.',
  oauth_denied: 'Google sign-in was cancelled or denied.',
  oauth_failed: 'Google sign-in failed. Please try again.',
  oauth_unavailable: 'Google sign-in is not available right now.',
  password_login_disabled: 'Password sign-in is disabled — use Google.',
}

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams
  const nextPath = normalizeAuthReturnPath(params.next ?? '/')
  const errorMessage = params.error ? (ERROR_MESSAGES[params.error] ?? 'Sign-in failed.') : null

  const googleEnabled = isGoogleOAuthConfigured()
  const passwordEnabled = process.env.ALLOW_PASSWORD_LOGIN !== 'false'

  const cookieStore = await cookies()
  const existingOperatorName = cookieStore.get(OPERATOR_NAME_COOKIE_NAME)?.value ?? ''

  return (
    <div className="min-h-[calc(100vh-120px)] bg-[#f4f6f9] dark:bg-navy-deep flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm bg-white dark:bg-navy-card border border-gray-100 dark:border-navy-border rounded-lg shadow-sm p-7">
        <h1 className="font-display font-bold text-2xl text-navy dark:text-white">
          ER SEO Tools
        </h1>
        <p className="mt-1 text-sm text-navy/60 dark:text-white/60">
          Sign in to continue.
        </p>

        {errorMessage && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
        )}

        {googleEnabled && (
          <a
            href={`/api/auth/google/start?next=${encodeURIComponent(nextPath)}`}
            className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-md border border-gray-300 dark:border-navy-border bg-white dark:bg-navy-deep px-4 py-2.5 text-sm font-semibold text-navy dark:text-white transition-colors hover:bg-gray-50 dark:hover:bg-navy-card"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.63Z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
            </svg>
            Sign in with Google
          </a>
        )}

        {googleEnabled && passwordEnabled && (
          <div className="mt-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-navy/40 dark:text-white/40">
            <span className="h-px flex-1 bg-gray-200 dark:bg-navy-border" />
            or
            <span className="h-px flex-1 bg-gray-200 dark:bg-navy-border" />
          </div>
        )}

        {!googleEnabled && !passwordEnabled && (
          <p className="mt-6 text-sm text-red-600 dark:text-red-400">
            No sign-in method is configured. Set up Google OAuth or enable password login.
          </p>
        )}

        {passwordEnabled && (
        <form action="/api/auth/login" method="post" className="mt-6 space-y-4">
          <input type="hidden" name="next" value={nextPath} />
          <div>
            <label htmlFor="operatorName" className="block text-sm font-semibold text-navy dark:text-white">
              Your name <span className="font-normal text-navy/40 dark:text-white/40">(optional)</span>
            </label>
            <input
              id="operatorName"
              name="operatorName"
              type="text"
              autoComplete="given-name"
              maxLength={OPERATOR_NAME_MAX_LENGTH}
              defaultValue={existingOperatorName}
              placeholder="e.g. Kevin"
              className="mt-2 w-full rounded-md border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-sm text-navy dark:text-white outline-none focus:border-orange focus:ring-2 focus:ring-orange/20"
            />
            <p className="mt-1 text-[11px] text-navy/40 dark:text-white/40">
              Shown next to audits you request. Saved on this machine only.
            </p>
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-navy dark:text-white">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-2 w-full rounded-md border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-sm text-navy dark:text-white outline-none focus:border-orange focus:ring-2 focus:ring-orange/20"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-light"
          >
            Sign In
          </button>
        </form>
        )}
      </div>
    </div>
  )
}
