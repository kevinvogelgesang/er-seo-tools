'use client'

// KS-3 Task 10 — client manage-page card for the per-client keyword profile
// (institution type, program roster, curated keyword locale, and
// scan-derived program suggestions). Spec §7. Every mutation PATCHes (or
// POSTs /suggest), then REFETCHES the whole profile on success (documented
// last-writer-wins mitigation — lib/services/keyword-profile.ts) rather than
// optimistically merging local state. Failures render the error envelope's
// `error` code, with friendly copy for the one code the UI can proactively
// avoid (no_live_scan_run) plus the stale-hasLiveScan race after it.
//
// `KeywordProfile` is a TYPE-ONLY import — this is a 'use client' component
// and lib/services/keyword-profile.ts pulls in prisma at runtime.

import { useCallback, useState } from 'react'
import {
  INSTITUTION_TYPES, type InstitutionType, type ProgramEntry, type ProgramSuggestion,
} from '@/lib/keywords/program-roster'
import { CURATED_LOCALES } from '@/lib/keywords/locales'
import type { KeywordProfile } from '@/lib/services/keyword-profile'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'

const TYPE_LABELS: Record<InstitutionType, string> = {
  trade: 'Trade / Career school', bootcamp: 'Bootcamp', university: 'University / College',
  k12: 'K-12', other: 'Other',
}

const NO_LIVE_SCAN_HINT = 'Run a site SEO scan first to derive suggestions.'

const ERROR_COPY: Record<string, string> = {
  no_live_scan_run: 'No completed site SEO scan for this client yet — run one first.',
  client_archived: 'This client is archived — the keyword profile is read-only.',
  suggestion_not_found: 'That suggestion is no longer available — it may already have been applied.',
  invalid_programs: 'Could not save that program roster change.',
  invalid_locale: 'That locale is not supported.',
}

function errorCopy(code: string | undefined): string {
  if (!code) return 'Something went wrong.'
  return ERROR_COPY[code] ?? code
}

const inputCls =
  'w-full border border-gray-300 dark:border-navy-border rounded px-2 py-1.5 bg-white dark:bg-navy-deep text-gray-800 dark:text-white/90 text-xs'
const labelCls = 'block text-xs text-gray-500 dark:text-white/50 mb-1'
const primaryBtnCls =
  'px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold disabled:opacity-50 hover:bg-blue-700 transition-colors'
const linkBtnCls =
  'text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:no-underline'
const removeBtnCls =
  'text-xs font-semibold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 disabled:no-underline'
const confirmBtnCls =
  'text-xs font-semibold text-green-600 dark:text-green-400 hover:underline disabled:opacity-50 disabled:no-underline'

export function KeywordProfileCard({ clientId, initialProfile, archived }: {
  clientId: number
  initialProfile: KeywordProfile
  archived: boolean
}) {
  const [profile, setProfile] = useState(initialProfile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add-program form.
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newCredential, setNewCredential] = useState('')

  // Advanced locale disclosure.
  const [advOpen, setAdvOpen] = useState(false)
  const [advLocationCode, setAdvLocationCode] = useState('')
  const [advLanguageCode, setAdvLanguageCode] = useState('')

  // Full-profile refetch-and-replace: the documented LWW concurrency posture
  // (spec §6, Codex-reviewed) — after every mutation the UI must display
  // SERVER truth wholesale, never a client-side merge that could mask a
  // concurrent writer's lost update.
  const refetch = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/keyword-profile`)
    if (res.ok) setProfile(await res.json())
  }, [clientId])

  // Returns true only after a successful PATCH + refetch — callers that
  // reset local form state (handleAddSubmit) must gate on it so a failure
  // never wipes the user's typed input out from under the error message.
  const mutate = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/keyword-profile`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) {
        const body2 = await res.json().catch(() => ({}))
        setError(errorCopy(body2.error))
        return false
      }
      await refetch() // LWW mitigation — ALWAYS refetch after a mutation (spec §6)
      return true
    } catch {
      setError('Request failed — check your connection.')
      return false
    } finally {
      setBusy(false)
    }
  }, [clientId, refetch])

  const suggest = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/keyword-profile/suggest`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(errorCopy(body.error))
        return
      }
      await refetch()
    } catch {
      setError('Request failed — check your connection.')
    } finally {
      setBusy(false)
    }
  }, [clientId, refetch])

  const disabled = busy || archived
  const suggestDisabled = disabled || !profile.hasLiveScan // plan-Codex #6: initial state, not just post-click 409

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    const entry: ProgramEntry = {
      name,
      confirmed: true,
      ...(newUrl.trim() ? { url: newUrl.trim() } : {}),
      ...(newCredential.trim() ? { credentialLevel: newCredential.trim() } : {}),
    }
    void mutate({ programs: [...profile.programs, entry] }).then((ok) => {
      if (!ok) return // keep the typed input alongside the error message
      setNewName('')
      setNewUrl('')
      setNewCredential('')
    })
  }

  function handleRemove(name: string) {
    void mutate({ programs: profile.programs.filter((p) => p.name !== name) })
  }

  function handleLocaleSelect(value: string) {
    if (!value) {
      void mutate({ locale: null })
      return
    }
    const [locStr, languageCode] = value.split(':')
    const locationCode = Number(locStr)
    const entry = CURATED_LOCALES.find(
      (l) => l.locationCode === locationCode && l.languageCode === languageCode,
    )
    if (!entry) return
    void mutate({ locale: { locationCode: entry.locationCode, languageCode: entry.languageCode, marketLabel: entry.label } })
  }

  function handleAdvancedApply() {
    const locationCode = Number(advLocationCode)
    const languageCode = advLanguageCode.trim().toLowerCase()
    if (!Number.isFinite(locationCode) || !languageCode) return
    void mutate({ locale: { locationCode, languageCode } })
  }

  const selectedLocaleValue = profile.locale ? `${profile.locale.locationCode}:${profile.locale.languageCode}` : ''

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">Keyword Profile</h2>
      </div>

      <Explainer label="What is this?" className="mb-3">
        <ExplainerSummary>
          The curated targeting profile that feeds keyword-strategy exports: institution type, the
          confirmed program roster, and the market/language locale used for search-volume lookups.
          Suggested programs are derived from the latest site SEO scan (page URLs, headings, and
          structured data) — confirm the real ones and dismiss the rest. Edits save immediately;
          if two people edit at once, the most recent save wins.
        </ExplainerSummary>
      </Explainer>

      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</p>}

      <div className="space-y-4">
        {/* Institution type */}
        <div>
          <label className={labelCls} htmlFor="kw-institution-type">Institution type</label>
          <select
            id="kw-institution-type"
            className={inputCls}
            value={profile.institutionType ?? ''}
            disabled={disabled}
            onChange={(e) => void mutate({ institutionType: (e.target.value || null) as InstitutionType | null })}
          >
            <option value="">Not set</option>
            {INSTITUTION_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {/* Keyword locale */}
        <div>
          <label className={labelCls} htmlFor="kw-locale">Keyword locale</label>
          <select
            id="kw-locale"
            aria-label="Keyword locale"
            className={inputCls}
            value={selectedLocaleValue}
            disabled={disabled}
            onChange={(e) => void handleLocaleSelect(e.target.value)}
          >
            <option value="">Not set</option>
            {CURATED_LOCALES.map((l) => (
              <option key={`${l.locationCode}:${l.languageCode}`} value={`${l.locationCode}:${l.languageCode}`}>
                {l.label}
              </option>
            ))}
          </select>

          <details className="mt-2" open={advOpen} onToggle={(e) => setAdvOpen((e.target as HTMLDetailsElement).open)}>
            <summary className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer select-none">
              Advanced
            </summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div>
                <label className={labelCls} htmlFor="kw-locale-adv-location">Location code</label>
                <input
                  id="kw-locale-adv-location"
                  type="text"
                  className={`${inputCls} w-28`}
                  value={advLocationCode}
                  disabled={disabled}
                  onChange={(e) => setAdvLocationCode(e.target.value)}
                  placeholder="e.g. 2840"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="kw-locale-adv-language">Language code</label>
                <input
                  id="kw-locale-adv-language"
                  type="text"
                  className={`${inputCls} w-20`}
                  value={advLanguageCode}
                  disabled={disabled}
                  onChange={(e) => setAdvLanguageCode(e.target.value)}
                  placeholder="e.g. en"
                />
              </div>
              <button
                type="button"
                className={primaryBtnCls}
                disabled={disabled}
                onClick={() => void handleAdvancedApply()}
              >
                Apply
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-400 dark:text-white/30">
              Regional variants like zh-TW aren&apos;t supported yet
            </p>
          </details>
        </div>

        {/* Program roster */}
        <div>
          <h3 className="text-xs font-semibold text-gray-600 dark:text-white/70 mb-1">Program roster</h3>
          {profile.programs.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-white/40 mb-2">
              No programs yet — add one or suggest from the latest scan.
            </p>
          ) : (
            <table className="w-full text-xs mb-2">
              <thead>
                <tr className="text-left text-gray-500 dark:text-white/50">
                  <th className="font-medium pb-1 pr-2">Name</th>
                  <th className="font-medium pb-1 pr-2">Credential</th>
                  <th className="font-medium pb-1 pr-2">URL</th>
                  <th className="font-medium pb-1 pr-2">Source</th>
                  <th className="font-medium pb-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
                {profile.programs.map((p) => (
                  <tr key={p.name}>
                    <td className="py-1 pr-2 text-gray-800 dark:text-white/90">{p.name}</td>
                    <td className="py-1 pr-2 text-gray-500 dark:text-white/50">{p.credentialLevel ?? '—'}</td>
                    <td className="py-1 pr-2">
                      {p.url ? (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          link
                        </a>
                      ) : (
                        <span className="text-gray-300 dark:text-white/20">—</span>
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <SeverityBadge tone={p.source === 'suggested' ? 'purple' : 'gray'} label={p.source ?? 'manual'} />
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        aria-label={`Remove ${p.name}`}
                        className={removeBtnCls}
                        disabled={disabled}
                        onClick={() => handleRemove(p.name)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form onSubmit={handleAddSubmit} className="flex flex-wrap items-end gap-2">
            <div>
              <label className={labelCls} htmlFor="kw-new-name">Program name</label>
              <input
                id="kw-new-name"
                type="text"
                className={`${inputCls} w-40`}
                value={newName}
                disabled={disabled}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Dental Assisting"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="kw-new-credential">Credential (optional)</label>
              <input
                id="kw-new-credential"
                type="text"
                className={`${inputCls} w-32`}
                value={newCredential}
                disabled={disabled}
                onChange={(e) => setNewCredential(e.target.value)}
                placeholder="e.g. Certificate"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="kw-new-url">URL (optional)</label>
              <input
                id="kw-new-url"
                type="text"
                className={`${inputCls} w-48`}
                value={newUrl}
                disabled={disabled}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <button type="submit" className={primaryBtnCls} disabled={disabled || !newName.trim()}>
              Add
            </button>
          </form>
        </div>

        {/* Suggestions */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-semibold text-gray-600 dark:text-white/70">Suggested programs</h3>
            <button
              type="button"
              className={linkBtnCls}
              disabled={suggestDisabled}
              onClick={() => void suggest()}
            >
              {busy ? 'Working…' : 'Suggest from latest scan'}
            </button>
          </div>

          {!profile.hasLiveScan && (
            <p className="text-[11px] text-gray-400 dark:text-white/30 mb-2">{NO_LIVE_SCAN_HINT}</p>
          )}

          {profile.suggestions && profile.suggestions.suggestions.length > 0 ? (
            <ul className="divide-y divide-gray-100 dark:divide-navy-border">
              {profile.suggestions.suggestions.map((s: ProgramSuggestion) => (
                <li key={s.name} className="py-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs text-gray-800 dark:text-white/90 mr-2">{s.name}</span>
                    <span className="inline-flex gap-1">
                      {s.evidence.map((ev) => (
                        <SeverityBadge key={ev} tone="gray" label={ev} />
                      ))}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      aria-label={`Confirm ${s.name}`}
                      className={confirmBtnCls}
                      disabled={disabled}
                      onClick={() => void mutate({ confirmSuggestion: s.name })}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      aria-label={`Dismiss ${s.name}`}
                      className={removeBtnCls}
                      disabled={disabled}
                      onClick={() => void mutate({ dismissSuggestion: s.name })}
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            profile.hasLiveScan && (
              <p className="text-xs text-gray-400 dark:text-white/40">
                No suggestions yet. Click &ldquo;Suggest from latest scan&rdquo; to derive some from the latest
                live SEO scan.
              </p>
            )
          )}
        </div>
      </div>
    </div>
  )
}
