// Viewbook global company content (spec §4/§10): typed bodies per key,
// strict whole-doc validation (read exactly as strict as write; corrupt rows
// read null, never throw), atomic team-photo attachment, and per-viewbook
// append-mode content overrides. Server-only.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { ASSET_FILENAME_RE } from './theme'
import { deleteViewbookAssets, saveViewbookAsset } from './assets'
import { syncVersionBumpAllStatement, syncVersionBumpAllWhere, syncVersionBumpStatement, syncVersionBumpWhere } from './sync'

import {
  GLOBAL_CONTENT_KEYS,
  type ContentBlocks,
  type GlobalContentKey,
  type TeamMember,
} from './global-content-keys'

export { GLOBAL_CONTENT_KEYS }
export type { ContentBlocks, GlobalContentKey, TeamMember }

const TEAM_CAPS = { members: 20, name: 120, role: 160, blurb: 2048 }
const BLOCK_CAPS = { blocks: 20, heading: 200, body: 4096 }
const OVERRIDE_BODY_CAP = 4096

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function isKnownKey(key: string): key is GlobalContentKey {
  return (GLOBAL_CONTENT_KEYS as readonly string[]).includes(key)
}

// Shared fence for both team-roster writers below (putTeamRoster,
// attachTeamPhoto): both pair this predicate with the SAME
// syncVersionBumpAllWhere in one $transaction — bump first, both hit or both
// miss — so a concurrent roster edit between load and write is caught as a
// 409 rather than silently clobbered.
function teamRosterFence(bodyJson: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "ViewbookGlobalContent" WHERE "key" = 'team' AND "bodyJson" = ${bodyJson}
  )`
}

function validateTeam(raw: unknown): TeamMember[] | null {
  if (!Array.isArray(raw) || raw.length > TEAM_CAPS.members) return null
  const out: TeamMember[] = []
  const seen = new Set<string>()
  for (const m of raw) {
    if (!isPlainObject(m)) return null
    if (Object.keys(m).length !== 4) return null
    const { name, role, photo, blurb } = m
    if (typeof name !== 'string' || name.length === 0 || name.length > TEAM_CAPS.name) return null
    if (typeof role !== 'string' || role.length === 0 || role.length > TEAM_CAPS.role) return null
    if (photo !== null && (typeof photo !== 'string' || !ASSET_FILENAME_RE.test(photo))) return null
    if (typeof blurb !== 'string' || blurb.length > TEAM_CAPS.blurb) return null
    // Unique names — the stable selector for photo attachment.
    if (seen.has(name)) return null
    seen.add(name)
    out.push({ name, role, photo: photo as string | null, blurb })
  }
  return out
}

function validateBlocks(raw: unknown): ContentBlocks | null {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 1 || !Array.isArray(raw.blocks)) return null
  if (raw.blocks.length > BLOCK_CAPS.blocks) return null
  const blocks: ContentBlocks['blocks'] = []
  for (const b of raw.blocks) {
    if (!isPlainObject(b) || Object.keys(b).length !== 2) return null
    const { heading, body } = b
    if (typeof heading !== 'string' || heading.length > BLOCK_CAPS.heading) return null
    if (typeof body !== 'string' || body.length > BLOCK_CAPS.body) return null
    blocks.push({ heading, body })
  }
  return { blocks }
}

export function validateGlobalContent(key: string, raw: unknown): TeamMember[] | ContentBlocks | null {
  if (!isKnownKey(key)) return null
  return key === 'team' ? validateTeam(raw) : validateBlocks(raw)
}

export async function putGlobalContent(key: string, raw: unknown, updatedBy: string): Promise<void> {
  const validated = validateGlobalContent(key, raw)
  if (!validated) throw new HttpError(400, 'invalid_content')

  if (key === 'team') {
    await putTeamRoster(validated as TeamMember[], updatedBy)
    return
  }
  const bodyJson = JSON.stringify(validated)
  // Unscoped bump: global content renders on every viewbook, so a change here
  // is visible everywhere at once.
  await prisma.$transaction([
    prisma.viewbookGlobalContent.upsert({
      where: { key },
      update: { bodyJson, updatedBy },
      create: { key, bodyJson, updatedBy },
    }),
    syncVersionBumpAllStatement(),
  ])
}

// Roster writes: photo filenames are single-owner (attachTeamPhoto is the only
// writer) — incoming `photo` values are IGNORED and re-derived from the stored
// roster by member name, so a stale tab's roster save can never resurrect a
// deleted photo file. The write is fenced on the loaded bodyJson (concurrent
// edit → 409 roster_conflict), and photos of REMOVED members are best-effort
// deleted (Codex PR1 review finding).
async function putTeamRoster(incoming: TeamMember[], updatedBy: string): Promise<void> {
  const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'team' } })
  let stored: TeamMember[] = []
  if (row) {
    try {
      stored = validateTeam(JSON.parse(row.bodyJson)) ?? []
    } catch {
      stored = []
    }
  }
  const storedPhotoByName = new Map(stored.map((m) => [m.name, m.photo]))
  const next = incoming.map((m) => ({ ...m, photo: storedPhotoByName.get(m.name) ?? null }))
  const bodyJson = JSON.stringify(next)

  if (!row) {
    await prisma.$transaction([
      prisma.viewbookGlobalContent.create({ data: { key: 'team', bodyJson, updatedBy } }),
      syncVersionBumpAllStatement(),
    ])
    return
  }
  // Fenced pair: the bump carries the SAME loaded-bodyJson predicate as the
  // updateMany below — bump first, both hit or both miss.
  const fence = teamRosterFence(row.bodyJson)
  const [, res] = await prisma.$transaction([
    syncVersionBumpAllWhere(fence),
    prisma.viewbookGlobalContent.updateMany({
      where: { key: 'team', bodyJson: row.bodyJson },
      data: { bodyJson, updatedBy },
    }),
  ])
  if (res.count === 0) throw new HttpError(409, 'roster_conflict')

  const keptNames = new Set(next.map((m) => m.name))
  const orphaned = stored
    .filter((m) => m.photo != null && !keptNames.has(m.name))
    .map((m) => m.photo as string)
  if (orphaned.length > 0) await deleteViewbookAssets('global', orphaned)
}

export async function getGlobalContent(key: GlobalContentKey): Promise<TeamMember[] | ContentBlocks | null> {
  const row = await prisma.viewbookGlobalContent.findUnique({ where: { key } })
  if (!row) return null
  try {
    return validateGlobalContent(key, JSON.parse(row.bodyJson))
  } catch {
    return null
  }
}

export async function getAllGlobalContent(): Promise<Record<GlobalContentKey, TeamMember[] | ContentBlocks | null>> {
  const out = {} as Record<GlobalContentKey, TeamMember[] | ContentBlocks | null>
  for (const key of GLOBAL_CONTENT_KEYS) {
    out[key] = await getGlobalContent(key)
  }
  return out
}

// Test seam only: lets a test inject a concurrent roster write between load
// and stamp to exercise the conflict path.
export interface AttachTeamPhotoDeps {
  beforeStamp?: () => Promise<void>
}

// One atomic multipart flow (Kevin decision): save file → conditional stamp
// fenced on the LOADED bodyJson (concurrent roster edit → 0 rows → delete the
// new file, honest 409) → delete the replaced photo. Returns the new filename.
export async function attachTeamPhoto(
  memberName: string,
  buf: Buffer,
  updatedBy: string,
  deps: AttachTeamPhotoDeps = {},
): Promise<string> {
  const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'team' } })
  if (!row) throw new HttpError(404, 'member_not_found')
  let roster: TeamMember[] | null = null
  try {
    const parsed: unknown = JSON.parse(row.bodyJson)
    roster = validateTeam(parsed)
  } catch {
    roster = null
  }
  if (!roster) throw new HttpError(409, 'roster_conflict')

  const member = roster.find((m) => m.name === memberName)
  const { filename } = await saveViewbookAsset('global', buf)
  if (!member) {
    await deleteViewbookAssets('global', [filename])
    throw new HttpError(404, 'member_not_found')
  }
  const oldPhoto = member.photo
  const next = roster.map((m) => (m.name === memberName ? { ...m, photo: filename } : m))

  if (deps.beforeStamp) await deps.beforeStamp()

  // Fenced pair: the bump carries the SAME loaded-bodyJson predicate as the
  // updateMany below — bump first, both hit or both miss.
  const fence = teamRosterFence(row.bodyJson)
  try {
    const [, res] = await prisma.$transaction([
      syncVersionBumpAllWhere(fence),
      prisma.viewbookGlobalContent.updateMany({
        where: { key: 'team', bodyJson: row.bodyJson },
        data: { bodyJson: JSON.stringify(next), updatedBy },
      }),
    ])
    if (res.count === 0) {
      await deleteViewbookAssets('global', [filename])
      throw new HttpError(409, 'roster_conflict')
    }
  } catch (err) {
    if (!(err instanceof HttpError)) await deleteViewbookAssets('global', [filename])
    throw err
  }

  if (oldPhoto && oldPhoto !== filename) await deleteViewbookAssets('global', [oldPhoto])
  return filename
}

// Per-viewbook "your plan" adjustments appended to the global base blocks.
export async function putContentOverride(
  viewbookId: number,
  contentKey: string,
  body: string,
  updatedBy: string,
): Promise<void> {
  if (!isKnownKey(contentKey)) throw new HttpError(400, 'invalid_content')
  if (typeof body !== 'string' || body.length === 0 || body.length > OVERRIDE_BODY_CAP) {
    throw new HttpError(400, 'invalid_content')
  }
  const vb = await prisma.viewbook.findUnique({ where: { id: viewbookId }, select: { id: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  // Scoped bump: an override affects only its own viewbook. The upsert either
  // succeeds or throws, rolling the bump back with it.
  await prisma.$transaction([
    prisma.viewbookContentOverride.upsert({
      where: { viewbookId_contentKey: { viewbookId, contentKey } },
      update: { body, updatedBy },
      create: { viewbookId, contentKey, body, updatedBy },
    }),
    syncVersionBumpStatement(viewbookId),
  ])
}

export async function deleteContentOverride(viewbookId: number, contentKey: string): Promise<void> {
  const fence = Prisma.sql`EXISTS (
    SELECT 1 FROM "ViewbookContentOverride" WHERE "viewbookId" = ${viewbookId} AND "contentKey" = ${contentKey}
  )`
  const [, res] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, fence),
    prisma.viewbookContentOverride.deleteMany({ where: { viewbookId, contentKey } }),
  ])
  if (res.count === 0) throw new HttpError(404, 'not_found')
}
