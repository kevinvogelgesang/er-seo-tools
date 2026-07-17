// v2 PR6: client-only WCAG contrast tester (spec Task 3). Mounted into
// BrandSection (Task 5). Persists nothing, no fetch, no useEditorActivity —
// a live matrix of the theme's real pairings (recomputed on every render, so
// it tracks ER's edits live) plus a free two-color pair-picker.
'use client'

import { useState } from 'react'
import { contrastRatio, contrastBands, type ContrastBands } from '@/lib/viewbook/contrast'
import { onThemeColorText, type ViewbookTheme } from '@/lib/viewbook/theme'

const PAGE_BG = '#fafafa'
const PAGE_TEXT = '#1a1a1a'

type Row = {
  key: string
  testId: string
  label: string
  fg: string
  bg: string
}

function buildRows(theme: ViewbookTheme): Row[] {
  return [
    { key: 'body', testId: 'contrast-row-body', label: 'Body text on page', fg: PAGE_TEXT, bg: PAGE_BG },
    {
      key: 'primary-on-page',
      testId: 'contrast-row-primary-on-page',
      label: 'Brand color as text on page',
      fg: theme.primary,
      bg: PAGE_BG,
    },
    {
      key: 'secondary-on-page',
      testId: 'contrast-row-secondary-on-page',
      label: 'Secondary color as text on page',
      fg: theme.secondary,
      bg: PAGE_BG,
    },
    {
      key: 'tertiary-on-page',
      testId: 'contrast-row-tertiary-on-page',
      label: 'Accent color as text on page',
      fg: theme.tertiary,
      bg: PAGE_BG,
    },
    {
      key: 'on-primary',
      testId: 'contrast-row-on-primary',
      label: 'Text on primary band',
      fg: onThemeColorText(theme.primary),
      bg: theme.primary,
    },
    {
      key: 'on-secondary',
      testId: 'contrast-row-on-secondary',
      label: 'Text on secondary band',
      fg: onThemeColorText(theme.secondary),
      bg: theme.secondary,
    },
    {
      key: 'on-tertiary',
      testId: 'contrast-row-on-tertiary',
      label: 'Text on accent band',
      fg: onThemeColorText(theme.tertiary),
      bg: theme.tertiary,
    },
  ]
}

const BAND_LABELS: Record<keyof ContrastBands, string> = {
  aaNormal: 'AA · normal',
  aaLarge: 'AA · large',
  aaaNormal: 'AAA · normal',
  aaaLarge: 'AAA · large',
}

const BAND_ORDER: (keyof ContrastBands)[] = ['aaNormal', 'aaLarge', 'aaaNormal', 'aaaLarge']

function BandChips({ bands }: { bands: ContrastBands }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {BAND_ORDER.map((bandKey) => {
        const pass = bands[bandKey]
        return (
          <span
            key={bandKey}
            data-band={bandKey}
            data-pass={pass}
            className={
              pass
                ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-500/20 dark:text-green-300'
                : 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-500/20 dark:text-red-300'
            }
          >
            {pass ? '✓' : '✗'} {BAND_LABELS[bandKey]}
          </span>
        )
      })}
    </div>
  )
}

function ContrastRow({ testId, label, fg, bg }: { testId: string; label: string; fg: string; bg: string }) {
  const ratio = contrastRatio(fg, bg)
  const bands = contrastBands(ratio)
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 rounded-lg border border-black/10 bg-white p-3 dark:border-navy-border dark:bg-navy-card sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-16 flex-shrink-0 items-center justify-center rounded-md border border-black/10 text-xs font-semibold dark:border-white/10"
          style={{ background: bg, color: fg }}
        >
          Aa
        </div>
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-white">{label}</div>
          <div data-testid="contrast-ratio" className="text-xs text-gray-500 dark:text-white/60">
            {ratio.toFixed(2)}:1
          </div>
        </div>
      </div>
      <BandChips bands={bands} />
    </div>
  )
}

export function ContrastTester({ theme }: { theme: ViewbookTheme }) {
  const rows = buildRows(theme)
  const [fg, setFg] = useState(PAGE_TEXT)
  const [bg, setBg] = useState(PAGE_BG)
  const pickerRatio = contrastRatio(fg, bg)
  const pickerBands = contrastBands(pickerRatio)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
          Contrast checker
        </h3>
        <p className="text-sm text-gray-600 dark:text-white/70">
          Contrast ratios for this theme&rsquo;s real color pairings, against WCAG AA/AAA.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <ContrastRow key={row.key} testId={row.testId} label={row.label} fg={row.fg} bg={row.bg} />
        ))}
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-navy-border dark:bg-navy-card">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Try any two colors</h4>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-white/70">
            Text color
            <input
              type="color"
              data-testid="pairpicker-fg"
              value={fg}
              onChange={(e) => setFg(e.target.value)}
              className="h-9 w-16 cursor-pointer rounded border border-black/10 dark:border-white/20"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-white/70">
            Background color
            <input
              type="color"
              data-testid="pairpicker-bg"
              value={bg}
              onChange={(e) => setBg(e.target.value)}
              className="h-9 w-16 cursor-pointer rounded border border-black/10 dark:border-white/20"
            />
          </label>
          <div
            className="flex h-14 w-24 flex-shrink-0 items-center justify-center rounded-md border border-black/10 text-sm font-semibold dark:border-white/10"
            style={{ background: bg, color: fg }}
          >
            Sample
          </div>
          <div>
            <div data-testid="pairpicker-ratio" className="text-sm font-medium text-gray-900 dark:text-white">
              {pickerRatio.toFixed(2)}:1
            </div>
            <BandChips bands={pickerBands} />
          </div>
        </div>
      </div>
    </div>
  )
}
