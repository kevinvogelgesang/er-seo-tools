// Task 8 (Lane 4): orphaned viewbook asset-FILE sweep. DB rows cascade-delete
// with the viewbook, but files under `viewbookAssetsDir()` do not — this is
// the disk-side cleanup.
//
// SAFETY (this is dangerous code — a wrong union or missing grace period
// deletes real theme/doc/assessment files):
// - A per-viewbook asset scope (`String(viewbookId)`) is shared by THREE
//   producers: theme assets (logo + section heroes, from `themeJson`), owned
//   `ViewbookDoc` rows, and `ViewbookAssessmentImage` rows. The referenced set
//   for a scope MUST be the union of all three — never just one.
// - The union lookup for a scope is computed as ONE `Promise.all` and wrapped
//   in try/catch: if ANY of the three queries throws, the whole scope is
//   ABORTED (nothing deleted for it, not even files that would have been
//   correctly identified as orphaned) — a partial union is worse than no
//   sweep at all, because it can positively misclassify a referenced file as
//   orphaned.
// - `'global'` is a DIFFERENT scope (team photos, `viewbookId: null` docs) and
//   is never touched by this per-viewbook logic.
// - Every candidate file must clear an age grace period
//   (`ORPHAN_ASSET_GRACE_MS`) measured from its own mtime, closing the race
//   where `saveViewbookAsset`/`saveViewbookDoc` has written the file but the
//   caller's DB row create (a separate statement, sometimes a separate
//   request) hasn't landed yet.
// - Only filenames matching the store's own filename grammars
//   (`ASSET_FILENAME_RE` / `DOC_FILENAME_RE`) are ever candidates — anything
//   else on disk (e.g. a stray `.tmp-*` from an interrupted atomic write) is
//   left alone; this sweep only ever removes well-formed, unreferenced,
//   sufficiently-old asset/doc files.

import { readdir, stat } from 'fs/promises'
import type { Dirent } from 'fs'
import path from 'path'
import { prisma } from '@/lib/db'
import { logError, logger } from '@/lib/log'
import { deleteViewbookAssets, viewbookAssetsDir, DOC_FILENAME_RE } from './assets'
import { ASSET_FILENAME_RE } from './theme'
import { parseStoredThemeWide } from './theme-server'

export const VIEWBOOK_ACTIVITY_RETENTION_MS = 180 * 24 * 60 * 60 * 1000

export async function pruneViewbookActivity(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - VIEWBOOK_ACTIVITY_RETENTION_MS)
  const result = await prisma.viewbookActivity.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return result.count
}

// A newly-written file must survive at least this long before it becomes a
// sweep candidate — long enough that no realistic write-then-DB-create gap
// (a single HTTP request) can span it.
export const ORPHAN_ASSET_GRACE_MS = 24 * 60 * 60 * 1000

// Guards against an unbounded directory listing turning into unbounded work
// in one cleanup pass; viewbook count is small (dozens), so this is a
// defensive ceiling, not an expected limit.
const MAX_SCOPE_DIRS_PER_SWEEP = 2000

// The COMPLETE referenced-filename union for one viewbook scope: theme
// (logo + section heroes) ∪ owned ViewbookDoc filenames ∪
// ViewbookAssessmentImage filenames ∪ ViewbookFeedbackImage filenames
// (feedback screenshots live in the same scope dir and outlive the 24-hour
// grace). A viewbook that no longer exists (fully deleted, cascade already
// ran) yields an empty theme contribution — that is correct: every leftover
// file in its scope directory is genuinely orphaned.
async function loadReferencedFilenames(viewbookId: number): Promise<Set<string>> {
  const [viewbook, docs, images, feedbackImages] = await Promise.all([
    prisma.viewbook.findUnique({ where: { id: viewbookId }, select: { themeJson: true } }),
    prisma.viewbookDoc.findMany({ where: { viewbookId }, select: { filename: true } }),
    prisma.viewbookAssessmentImage.findMany({ where: { content: { viewbookId } }, select: { filename: true } }),
    prisma.viewbookFeedbackImage.findMany({
      where: { feedback: { reviewLink: { milestone: { viewbookId } } } },
      select: { filename: true },
    }),
  ])

  const referenced = new Set<string>()
  if (viewbook) {
    const theme = parseStoredThemeWide(viewbook.themeJson)
    if (theme.logo) referenced.add(theme.logo)
    for (const hero of Object.values(theme.sectionHeroes)) referenced.add(hero)
  }
  for (const doc of docs) referenced.add(doc.filename)
  for (const img of images) referenced.add(img.filename)
  for (const img of feedbackImages) referenced.add(img.filename)
  return referenced
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/**
 * Sweep every per-viewbook asset scope directory for files that are (a) not
 * in that viewbook's referenced union and (b) older than the grace period,
 * deleting only those. Returns the count of files deleted. Never throws —
 * failures are logged and treated as "abort this scope" / "abort this file",
 * never as license to delete more broadly.
 */
export async function pruneOrphanedViewbookAssetFiles(now: Date = new Date()): Promise<number> {
  const rootDir = viewbookAssetsDir()
  let entries: Dirent[]
  try {
    entries = await readdir(rootDir, { withFileTypes: true })
  } catch (err) {
    if (isEnoent(err)) return 0
    logError({ subsystem: 'viewbook', op: 'orphan-asset-sweep-root' }, err)
    return 0
  }

  let deleted = 0
  let scopesSwept = 0
  const deletedByScope: Record<string, string[]> = {}

  for (const entry of entries) {
    if (scopesSwept >= MAX_SCOPE_DIRS_PER_SWEEP) break
    if (!entry.isDirectory()) continue
    const scope = entry.name
    if (scope === 'global') continue // never sweep global with per-viewbook logic
    if (!/^[1-9][0-9]*$/.test(scope)) continue // not a viewbook-id scope directory
    const viewbookId = Number(scope)
    scopesSwept++

    let referenced: Set<string>
    try {
      referenced = await loadReferencedFilenames(viewbookId)
    } catch (err) {
      // SAFETY: a failed/partial union lookup must never lead to deleting
      // files in this scope — abort it entirely and move on.
      logError({ subsystem: 'viewbook', op: 'orphan-asset-sweep-lookup', viewbookId }, err)
      continue
    }

    const scopeDir = path.join(rootDir, scope)
    let files: Dirent[]
    try {
      files = await readdir(scopeDir, { withFileTypes: true })
    } catch (err) {
      if (isEnoent(err)) continue
      logError({ subsystem: 'viewbook', op: 'orphan-asset-sweep-list', viewbookId }, err)
      continue
    }

    for (const file of files) {
      if (!file.isFile()) continue
      const filename = file.name
      // Only well-formed asset/doc filenames are ever candidates — a stray
      // temp file or anything else on disk is left alone.
      if (!ASSET_FILENAME_RE.test(filename) && !DOC_FILENAME_RE.test(filename)) continue
      if (referenced.has(filename)) continue // referenced — preserve, no exceptions

      let ageMs: number
      try {
        const stats = await stat(path.join(scopeDir, filename))
        ageMs = now.getTime() - stats.mtimeMs
      } catch (err) {
        if (isEnoent(err)) continue // already gone
        logError({ subsystem: 'viewbook', op: 'orphan-asset-sweep-stat', viewbookId, filename }, err)
        continue
      }
      if (ageMs < ORPHAN_ASSET_GRACE_MS) continue // too new — may be mid-write, DB row not committed yet

      await deleteViewbookAssets(scope, [filename])
      deleted++
      ;(deletedByScope[scope] ??= []).push(filename)
    }
  }

  if (deleted > 0) {
    logger.info(
      { subsystem: 'viewbook', op: 'orphan-asset-sweep', deleted, scopes: Object.keys(deletedByScope).length, deletedByScope },
      'swept orphaned viewbook asset files',
    )
  }

  return deleted
}
