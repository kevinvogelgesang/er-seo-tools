// app/api/reports/schedule/route.ts
//
// GET  /api/reports/schedule — return the current 'seo-report-monthly' Schedule
//                              (or {schedule:null} if it hasn't been created yet).
// PUT  /api/reports/schedule — upsert the 'seo-report-monthly' Schedule.
//
// This is an operator-configurable, NON-system Schedule.
// Its name does NOT start with 'system-', so the seedSystemSchedules() retired-row
// cleanup (name startsWith 'system-', notIn SYSTEM_SCHEDULES) will never touch it.
//
// Cadence format: 'monthly:<day>@HH:MM'  (day ∈ 1..28, time 24h HH:MM)
// Payload stored: { comparisonMode: 'prev_period' | 'prev_year' }
// jobType: SEO_REPORT_MONTHLY_RUN_JOB_TYPE

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { nextRun } from '@/lib/jobs/scheduler'
import { SEO_REPORT_MONTHLY_RUN_JOB_TYPE } from '@/lib/jobs/handlers/seo-report-monthly-run'

export const SEO_REPORT_MONTHLY_SCHEDULE_NAME = 'seo-report-monthly'

// ── Validation helpers ────────────────────────────────────────────────────────

function isValidDay(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 28
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function isValidTime(v: unknown): v is string {
  return typeof v === 'string' && TIME_RE.test(v)
}

type ComparisonMode = 'prev_period' | 'prev_year'

function isValidComparisonMode(v: unknown): v is ComparisonMode {
  return v === 'prev_period' || v === 'prev_year'
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  const schedule = await prisma.schedule.findUnique({
    where: { name: SEO_REPORT_MONTHLY_SCHEDULE_NAME },
    select: {
      id: true,
      enabled: true,
      cadence: true,
      payload: true,
      nextRunAt: true,
      lastRunAt: true,
    },
  })

  if (!schedule) {
    return NextResponse.json({ schedule: null })
  }

  let comparisonMode: ComparisonMode = 'prev_period'
  try {
    const p = JSON.parse(schedule.payload) as Record<string, unknown>
    if (isValidComparisonMode(p.comparisonMode)) comparisonMode = p.comparisonMode
  } catch { /* keep default */ }

  // Parse day + time back from cadence for the UI.
  const match = /^monthly:(\d{1,2})@(\d{2}:\d{2})$/.exec(schedule.cadence)
  const day = match ? Number.parseInt(match[1], 10) : null
  const time = match ? match[2] : null

  return NextResponse.json({
    schedule: {
      id: schedule.id,
      enabled: schedule.enabled,
      cadence: schedule.cadence,
      day,
      time,
      comparisonMode,
      nextRunAt: schedule.nextRunAt,
      lastRunAt: schedule.lastRunAt,
    },
  })
}

// ── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Validate enabled
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled_required', detail: 'enabled must be boolean' }, { status: 400 })
  }

  // Validate day ∈ 1..28
  if (!isValidDay(body.day)) {
    return NextResponse.json({ error: 'day_invalid', detail: 'day must be an integer 1–28' }, { status: 400 })
  }

  // Validate time HH:MM (24h)
  if (!isValidTime(body.time)) {
    return NextResponse.json({ error: 'time_invalid', detail: 'time must be HH:MM (24h)' }, { status: 400 })
  }

  // Validate comparisonMode
  if (!isValidComparisonMode(body.comparisonMode)) {
    return NextResponse.json(
      { error: 'comparison_mode_invalid', detail: 'comparisonMode must be prev_period or prev_year' },
      { status: 400 },
    )
  }

  const cadence = `monthly:${body.day}@${body.time}`
  const payload = JSON.stringify({ comparisonMode: body.comparisonMode })
  const now = new Date()

  const upserted = await prisma.schedule.upsert({
    where: { name: SEO_REPORT_MONTHLY_SCHEDULE_NAME },
    create: {
      name: SEO_REPORT_MONTHLY_SCHEDULE_NAME,
      jobType: SEO_REPORT_MONTHLY_RUN_JOB_TYPE,
      cadence,
      payload,
      enabled: body.enabled,
      nextRunAt: nextRun(cadence, now),
    },
    update: {
      jobType: SEO_REPORT_MONTHLY_RUN_JOB_TYPE,
      cadence,
      payload,
      enabled: body.enabled,
      nextRunAt: nextRun(cadence, now),
    },
    select: { id: true },
  })

  return NextResponse.json({ id: upserted.id })
}
