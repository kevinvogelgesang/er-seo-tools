// Pure metrics feeding the public viewbook's rich summary faces (PR7 Task 6).
// Each function takes only the slice of ViewbookPublicData it needs so it can
// be unit-tested without a full payload fixture. NO server imports — this
// module is consumed from server components but must stay import-safe from
// client code too (the public-types.ts precedent).
import type { PublicFieldCategory, PublicMilestone, PublicTeamMember } from './public-types'

export function milestoneProgress(m: PublicMilestone[]): { done: number; total: number } {
  return { done: m.filter((x) => x.status === 'done').length, total: m.length }
}

// A field "counts" as answered when its value is non-null and has non-
// whitespace content — mirrors the FieldValue "Not provided yet" placeholder
// rule in DataSourceSection.
export function answeredProgress(cats: PublicFieldCategory[]): { answered: number; total: number } {
  const fields = cats.flatMap((c) => c.fields)
  const answered = fields.filter((f) => f.value != null && f.value.trim() !== '').length
  return { answered, total: fields.length }
}

// `invited` is EXISTENCE-only (a delivery row exists), never send status —
// see PublicTeamMember's doc comment. This just tallies it.
export function inviteProgress(members: PublicTeamMember[]): { invited: number; total: number } {
  return { invited: members.filter((m) => m.invited).length, total: members.length }
}

export function docCount(docs: { global: unknown[]; own: unknown[] }): number {
  return docs.global.length + docs.own.length
}
