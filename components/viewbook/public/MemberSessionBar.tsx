'use client'

import { useState } from 'react'

export function MemberSessionBar({ token, name }: { token: string; name: string }) {
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      await fetch(`/api/viewbook/${token}/auth/logout`, { method: 'POST' })
    } finally {
      window.location.reload()
    }
  }

  return (
    <div className="flex items-center justify-end gap-3 bg-[#122033] px-4 py-2 text-sm text-white">
      <span>Signed in as {name}</span>
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="rounded border border-white/40 px-2.5 py-1 font-medium hover:bg-white/10 disabled:opacity-60"
      >
        Sign out
      </button>
    </div>
  )
}
