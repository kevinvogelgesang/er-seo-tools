'use client'

import { FormEvent, useEffect, useState } from 'react'

type LandingState = 'idle' | 'sent' | 'consuming' | 'expired'

export function AuthLanding({ token }: { token: string }) {
  const [email, setEmail] = useState('')
  const [grant, setGrant] = useState<string | null>(null)
  const [state, setState] = useState<LandingState>('idle')

  useEffect(() => {
    const match = /^#g=(.+)$/.exec(window.location.hash)
    if (!match) return

    try {
      setGrant(decodeURIComponent(match[1]))
    } catch {
      setState('expired')
    }
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await fetch(`/api/viewbook/${token}/auth/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } finally {
      setState('sent')
    }
  }

  async function consumeGrant() {
    if (!grant) return
    setState('consuming')
    try {
      const response = await fetch(`/api/viewbook/${token}/auth/consume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ g: grant }),
      })
      if (response.ok) {
        window.location.replace(`/viewbook/${token}`)
        return
      }
    } catch {
      // Consume failures intentionally share the same expired-link recovery UI.
    }
    setGrant(null)
    setState('expired')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 dark:bg-slate-950">
      <section className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="bg-[#122033] px-7 py-5 text-lg font-semibold text-white">
          Enrollment Resources
        </div>
        <div className="space-y-5 px-7 py-8 text-slate-700 dark:text-slate-200">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950 dark:text-white">Open your onboarding viewbook</h1>
            <p className="mt-3 leading-6">
              This onboarding viewbook is invitation-only. Enter your email and we&apos;ll send you a sign-in link if you&apos;ve been invited.
            </p>
          </div>

          {grant ? (
            <div className="space-y-4">
              <p>Your secure sign-in link is ready.</p>
              <button
                type="button"
                onClick={consumeGrant}
                disabled={state === 'consuming'}
                className="w-full rounded-lg bg-[#c99334] px-4 py-3 font-semibold text-[#122033] disabled:cursor-wait disabled:opacity-70"
              >
                {state === 'consuming' ? 'Opening…' : 'Continue'}
              </button>
            </div>
          ) : state === 'sent' ? (
            <p role="status" className="rounded-lg bg-slate-100 px-4 py-3 dark:bg-slate-800">
              If this address was invited, a link is on its way.
            </p>
          ) : (
            <form onSubmit={requestLink} className="space-y-4">
              {state === 'expired' ? (
                <p role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  That link has expired — request a fresh one.
                </p>
              ) : null}
              <label className="block space-y-2">
                <span className="font-medium">Email address</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 outline-none focus:border-[#c99334] focus:ring-2 focus:ring-[#c99334]/30 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </label>
              <button type="submit" className="w-full rounded-lg bg-[#122033] px-4 py-3 font-semibold text-white">
                Send sign-in link
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  )
}
