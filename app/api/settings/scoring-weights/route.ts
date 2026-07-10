import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { PERSISTABLE_WEIGHT_KEYS, validateWeights } from '@/lib/scoring/weights'
import { resolveScoringWeights } from '@/lib/scoring/resolve-weights'

export async function GET() {
  return NextResponse.json({ weights: await resolveScoringWeights() })
}
export async function PUT(request: Request) {
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const v = validateWeights(body ?? {})
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })
  // Explicit pick of ONLY the columns that exist on the ScoringWeights row — a spread of `v`
  // would hit Prisma's unknown-argument error at runtime if ScoringWeights ever gained a
  // client-only field tsc can't catch (PERSISTABLE_WEIGHT_KEYS now covers all 9 columns,
  // including brokenLinks since C19 PR3).
  const persisted = Object.fromEntries(PERSISTABLE_WEIGHT_KEYS.map((k) => [k, v[k]])) as Pick<
    typeof v, (typeof PERSISTABLE_WEIGHT_KEYS)[number]
  >
  await prisma.scoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...persisted }, update: { ...persisted } })
  return NextResponse.json({ weights: v })
}
