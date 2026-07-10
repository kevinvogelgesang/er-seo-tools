import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { validateAdaWeights } from '@/lib/scoring/ada-weights'
import { resolveAdaScoringWeights } from '@/lib/scoring/resolve-ada-weights'

export const GET = withRoute(async () => {
  return NextResponse.json({ weights: await resolveAdaScoringWeights() })
})

export const PUT = withRoute(async (request: NextRequest) => {
  const body = await parseJsonBody<Record<string, unknown>>(request)
  const v = validateAdaWeights(body ?? {})
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })
  await prisma.adaScoringWeights.upsert({ where: { id: 1 }, create: { id: 1, ...v }, update: { ...v } })
  return NextResponse.json({ weights: v })
})
