// Data Source (spec §8): Q&A grouped by catalog category, read-only in PR2.
// PR3 owned inline editing, autosave, propose-a-change. PR5 Task 7 adds a
// post-contract intro line + the shared ack action — data-source is one of
// the three ackable sections (lib/viewbook/ack.ts's ACKABLE_SECTION_KEYS) and
// sits in the post-contract primary flow.
import type { PublicField, PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { answeredProgress } from '@/lib/viewbook/summary-metrics'
import { CATEGORY_LABELS } from '@/lib/viewbook/category-labels'
import { categoryAnchor, fieldAnchor } from '@/lib/viewbook/anchors'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { FieldEditor } from './FieldEditor'
import { AmendmentForm } from './AmendmentForm'
import { AckButton } from './AckButton'
import { SummaryStat } from './SummaryStat'
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

function who(author: string | null): string {
  return author === 'client' ? 'you' : 'our team'
}

function ListValue({ value }: { value: string }) {
  let items: string[] | null = null
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) items = parsed
  } catch {
    items = null
  }
  if (!items) return <p className="whitespace-pre-line">{value}</p>
  return (
    <ul className="list-disc pl-5">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  )
}

function FieldValue({ field, muted = false }: { field: PublicField; muted?: boolean }) {
  if (field.value == null || field.value === '') return <p className="text-black/35">Not provided yet</p>
  if (field.fieldType === 'list') {
    return <div className={muted ? 'text-black/45' : undefined}><ListValue value={field.value} /></div>
  }
  return <p className={`whitespace-pre-line ${muted ? 'text-black/45' : ''}`}>{field.value}</p>
}

function FieldRow({ field, token, dataLockedAt }: { field: PublicField; token: string; dataLockedAt: string | null }) {
  const lockedBaseline = dataLockedAt !== null
    && new Date(field.createdAt).getTime() <= new Date(dataLockedAt).getTime()
  return (
    <div
      id={fieldAnchor(field.id).slice(1)}
      data-vb-locked={lockedBaseline}
      className={`px-5 py-3 ${lockedBaseline ? 'bg-black/[0.04] text-black/50' : ''}`}
    >
      <div data-vb-locked-content={lockedBaseline} aria-disabled={lockedBaseline || undefined}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm font-semibold ${lockedBaseline ? 'text-black/45' : 'text-black/60'}`}>{field.label}</p>
          {lockedBaseline && (
            <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.06] px-2 py-0.5 text-xs font-semibold text-black/45">
              <span aria-hidden>🔒</span>
              <span>Locked baseline</span>
            </span>
          )}
        </div>
        {lockedBaseline ? <FieldValue field={field} muted /> : <FieldEditor token={token} field={field} />}
        {dataLockedAt && !lockedBaseline && field.isCustom && (
          <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--vb-primary)' }}>Added after lock-in · still editable</p>
        )}
        {field.valueUpdatedAt && (
          <p className="mt-1 text-xs text-black/40">
            Last updated by {who(field.valueUpdatedBy)} on {fmtDate(field.valueUpdatedAt)}
          </p>
        )}
        {field.amendments.map((a) => (
          <div key={a.id} className="mt-2 border-l-4 pl-3" style={{ borderColor: 'var(--vb-tertiary)' }}>
            {field.fieldType === 'list' ? <ListValue value={a.value} /> : <p className="whitespace-pre-line">{a.value}</p>}
            <p className="text-xs text-black/40">
              changed on {fmtDate(a.createdAt)} by {who(a.author)}
            </p>
          </div>
        ))}
      </div>
      {lockedBaseline && (
        <details className="mt-3 rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-black/70">
          <summary className="cursor-pointer text-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vb-secondary)]">
            Propose a change
          </summary>
          <AmendmentForm token={token} fieldId={field.id} fieldType={field.fieldType} label={field.label} />
        </details>
      )}
    </div>
  )
}

export function DataSourceSection({
  section,
  data,
  token,
  isOperator = false,
  meta,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
  isOperator?: boolean
  meta: SectionRenderMeta
}) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  const { answered, total } = answeredProgress(data.fieldCategories)
  return (
    <SectionShell
      section={section}
      stage={data.stage}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={<SummaryStat headline={`${answered} of ${total} answered`} />}
      affordance={data.collapseAffordance}
      overlayStrength={data.heroOverlayStrength}
      isOperator={isOperator}
      viewbookId={data.viewbookId}
      token={token}
      meta={meta}
      viewerMode={data.viewerMode}
    >
      {data.stage === 'post-contract' && (
        <p className="text-black/60">
          Fill in what you can before the kickoff call — you can always add more later.
        </p>
      )}
      {data.dataLockedAt && (
        <div
          className="rounded-lg px-4 py-3 text-sm font-medium"
          style={{ background: 'var(--vb-primary)', color: 'var(--vb-on-primary)' }}
        >
          These answers were locked in on {fmtDate(data.dataLockedAt)}. Amendments appear beside the
          original answers.
        </div>
      )}
      {data.fieldCategories.length === 0 && (
        <p className="text-black/50">The launch questionnaire will appear here.</p>
      )}
      {data.fieldCategories.map((cat) => (
        <details key={cat.category} id={categoryAnchor(cat.category).slice(1)} open className="rounded-xl border border-black/10 bg-white shadow-sm">
          <summary
            className="cursor-pointer px-5 py-3 text-lg font-bold"
            style={{ fontFamily: 'var(--vb-heading-font)' }}
          >
            {CATEGORY_LABELS[cat.category] ?? cat.category}
          </summary>
          <div className="divide-y divide-black/5">
            {cat.fields.map((f) => (
              <FieldRow key={f.id} field={f} token={token} dataLockedAt={data.dataLockedAt} />
            ))}
          </div>
        </details>
      ))}
      {data.stage === 'post-contract' && (
        <AckButton token={token} sectionKey="data-source" acknowledgedAt={section.acknowledgedAt} />
      )}
    </SectionShell>
  )
}
