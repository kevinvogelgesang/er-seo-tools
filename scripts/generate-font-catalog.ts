// Regenerates lib/viewbook/font-catalog.json from the public Google Fonts
// metadata endpoint (no API key). Run: npx tsx scripts/generate-font-catalog.ts
//
// Policy (mirrors the curated font-manifest.ts generation policy, widened to
// the full catalog): keep families that ship a regular (400) non-italic face
// and support the latin subset; slug the family name (lowercase, spaces→'-');
// store the family's available non-italic static weights. Icon/emoji families
// and any slug that fails the STORED_KEY grammar are skipped. The 12 original
// stored keys in FONT_MANIFEST must survive with identical slugs — the
// font-catalog test enforces that superset invariant.

import { writeFile } from 'fs/promises'
import path from 'path'

const SOURCE = 'https://fonts.google.com/metadata/fonts'
const OUT = path.join(process.cwd(), 'lib', 'viewbook', 'font-catalog.json')
const SLUG_RE = /^[a-z0-9-]+$/

interface FamilyMetadata {
  family: string
  subsets: string[]
  fonts: Record<string, unknown> // keys like "400", "400i", "700"
}

function slugify(family: string): string {
  return family.toLowerCase().replaceAll(' ', '-')
}

async function main() {
  const res = await fetch(SOURCE)
  if (!res.ok) throw new Error(`metadata fetch failed: ${res.status}`)
  let text = await res.text()
  // The endpoint historically prefixed an XSSI guard line (")]}'"); strip if present.
  if (text.startsWith(")]}'")) text = text.slice(text.indexOf('\n') + 1)
  const parsed = JSON.parse(text) as { familyMetadataList: FamilyMetadata[] }

  const catalog: Record<string, [string, string[]]> = {}
  for (const fam of parsed.familyMetadataList) {
    if (!fam.subsets?.includes('latin')) continue
    if (/icons|emoji/i.test(fam.family)) continue
    const weights = Object.keys(fam.fonts ?? {})
      .filter((w) => /^\d+$/.test(w))
      .sort((a, b) => Number(a) - Number(b))
    if (!weights.includes('400')) continue
    const slug = slugify(fam.family)
    if (!SLUG_RE.test(slug)) continue
    catalog[slug] = [fam.family, weights]
  }

  const ordered = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(OUT, JSON.stringify(ordered))
  console.log(`wrote ${OUT}: ${Object.keys(ordered).length} families`)
}

void main()
