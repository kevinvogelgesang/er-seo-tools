import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateWeights } from '@/lib/scoring/weights'
import { resolveScoringWeights } from '@/lib/scoring/resolve-weights'

export async function GET() {
  return NextResponse.json({ weights: await resolveScoringWeights() })
}
export async function PUT(request: Request) {
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  const v = validateWeights(body ?? {})
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })
  await prisma.scoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...v }, update: { ...v } })
  return NextResponse.json({ weights: v })
}
