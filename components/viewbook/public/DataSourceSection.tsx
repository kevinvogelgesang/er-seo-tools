// Data Source (spec §8): Q&A grouped by catalog category, read-only in PR2.
// PR3 owned inline editing, autosave, propose-a-change. PR5 Task 7 adds a
// post-contract intro line + the shared ack action — data-source is one of
// the three ackable sections (lib/viewbook/ack.ts's ACKABLE_SECTION_KEYS) and
// sits in the post-contract primary flow.
import type { PublicField, PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'
import { FieldEditor } from './FieldEditor'
import { AmendmentForm } from './AmendmentForm'
import { AckButton } from './AckButton'

const CATEGORY_LABELS: Record<string, string> = {
  school: 'Your school',
  programs: 'Programs',
  'team-access': 'Team & access',
  'crm-leads': 'CRM & leads',
  admissions: 'Admissions',
  positioning: 'Positioning',
  'student-experience': 'Student experience',
  'brand-materials': 'Brand & materials',
}

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

function FieldValue({ field }: { field: PublicField }) {
  if (field.value == null || field.value === '') return <p className="text-black/35">Not provided yet</p>
  if (field.fieldType === 'list') return <ListValue value={field.value} />
  return <p className="whitespace-pre-line">{field.value}</p>
}

function FieldRow({ field, token, dataLockedAt }: { field: PublicField; token: string; dataLockedAt: string | null }) {
  const lockedBaseline = dataLockedAt !== null
    && new Date(field.createdAt).getTime() <= new Date(dataLockedAt).getTime()
  return (
    <div className="px-5 py-3">
      <p className="text-sm font-semibold text-black/60">{field.label}</p>
      {lockedBaseline ? <FieldValue field={field} /> : <FieldEditor token={token} field={field} />}
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
      {lockedBaseline && (
        <AmendmentForm token={token} fieldId={field.id} fieldType={field.fieldType} label={field.label} />
      )}
    </div>
  )
}

export function DataSourceSection({
  section,
  data,
  token,
}: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
}) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  return (
    <SectionShell
      section={section}
      stage={data.stage}
      title={SECTION_TITLES[section.sectionKey]}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
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
        <details key={cat.category} open className="rounded-xl border border-black/10 bg-white shadow-sm">
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
