import { cookies } from 'next/headers'
import { normalizeAuthReturnPath, OPERATOR_NAME_COOKIE_NAME, OPERATOR_NAME_MAX_LENGTH } from '@/lib/auth'

interface Props {
  searchParams: Promise<{ next?: string; error?: string }>
}

export const metadata = {
  title: 'Login',
}

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams
  const nextPath = normalizeAuthReturnPath(params.next ?? '/')
  const hasError = params.error === 'invalid'

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

          {hasError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              Invalid password.
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-light"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}
