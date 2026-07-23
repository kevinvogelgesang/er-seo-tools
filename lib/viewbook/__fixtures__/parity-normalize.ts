// F2 rendered-parity fixture support (Task 1 / Task 10). Pure normalizer that
// strips nondeterministic values (autoincrement ids, tokens, timestamps, and
// per-run-random photo filenames) out of a captured `ViewbookPublicData`
// payload so a fresh capture and a later re-capture (post-cutover) can be
// compared for byte-for-byte structural equality. Test-support module — NOT
// a build artifact, hence living under __fixtures__ rather than scripts/.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const PHOTO_RE = /^[0-9a-f-]{36}\.webp$/

export function normalizeParityPayload(data: unknown): unknown {
  const photoMap = new Map<string, string>()
  return JSON.parse(
    JSON.stringify(data, (key, value) => {
      if (key === 'viewbookId' || key === 'id') return 0
      if (key === 'token') return 'TOKEN'
      if (typeof value === 'string' && ISO_RE.test(value)) return 'TS'
      if (key === 'photo' && typeof value === 'string' && PHOTO_RE.test(value)) {
        if (!photoMap.has(value)) photoMap.set(value, `PHOTO_${photoMap.size + 1}`)
        return photoMap.get(value)
      }
      return value
    }),
  )
}
