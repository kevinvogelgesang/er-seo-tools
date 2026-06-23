// app/api/reports/schedule/route.test.ts
//
// DB-backed tests for GET/PUT /api/reports/schedule.
// Covers:
//   - PUT upserts with cadence 'monthly:<day>@HH:MM' + payload {comparisonMode}.
//   - PUT validation rejects day=0, day=29, bad time, bad comparisonMode (400).
//   - The stored row is NOT a system schedule (name doesn't start with 'system-').
//   - GET returns the upserted schedule.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, PUT } from './route'
import { SYSTEM_SCHEDULES } from '@/lib/jobs/system-schedules'
import { SEO_REPORT_MONTHLY_RUN_JOB_TYPE, SEO_REPORT_MONTHLY_SCHEDULE_NAME } from '@/lib/jobs/handlers/seo-report-monthly-run'

function jsonReq(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/reports/schedule', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeAll(async () => {
  // Clean any leftover row from a failed prior run.
  await prisma.schedule.deleteMany({ where: { name: SEO_REPORT_MONTHLY_SCHEDULE_NAME } })
})

afterAll(async () => {
  await prisma.schedule.deleteMany({ where: { name: SEO_REPORT_MONTHLY_SCHEDULE_NAME } })
})

describe('GET /api/reports/schedule — before any PUT', () => {
  it('returns {schedule:null} when no schedule exists yet', async () => {
    const res = await GET(jsonReq('GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ schedule: null })
  })
})

describe('PUT /api/reports/schedule — validation', () => {
  it('400 when enabled is missing', async () => {
    const res = await PUT(jsonReq('PUT', { day: 1, time: '06:00', comparisonMode: 'prev_period' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('enabled_required')
  })

  it('400 when day = 0', async () => {
    const res = await PUT(jsonReq('PUT', { enabled: true, day: 0, time: '06:00', comparisonMode: 'prev_period' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('day_invalid')
  })

  it('400 when day = 29', async () => {
    const res = await PUT(jsonReq('PUT', { enabled: true, day: 29, time: '06:00', comparisonMode: 'prev_period' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('day_invalid')
  })

  it('400 when day is a string', async () => {
    const res = await PUT(jsonReq('PUT', { enabled: true, day: '5', time: '06:00', comparisonMode: 'prev_period' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('day_invalid')
  })

  it('400 when time is invalid format', async () => {
    const res = await PUT(jsonReq('PUT', { enabled: true, day: 1, time: '6:00', comparisonMode: 'prev_period' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('time_invalid')
  })

  it('400 when time is 25:00', async () => {
    const res = await PUT(jsonReq('PUT', { enabled: true, day: 1, time: '25:00', comparisonMode: 'prev_period' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('time_invalid')
  })

  it('400 when comparisonMode is invalid', async () => {
    const res = await PUT(jsonReq('PUT', { enabled: true, day: 1, time: '06:00', comparisonMode: 'monthly' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('comparison_mode_invalid')
  })
})

describe('PUT /api/reports/schedule — upsert', () => {
  it('creates the schedule with correct cadence + payload on first PUT', async () => {
    const res = await PUT(jsonReq('PUT', { enabled: true, day: 5, time: '06:00', comparisonMode: 'prev_period' }))
    expect(res.status).toBe(200)
    const { id } = await res.json()
    expect(typeof id).toBe('string')

    const sched = await prisma.schedule.findUnique({ where: { id } })
    expect(sched).not.toBeNull()
    expect(sched!.name).toBe(SEO_REPORT_MONTHLY_SCHEDULE_NAME)
    expect(sched!.cadence).toBe('monthly:5@06:00')
    expect(sched!.jobType).toBe(SEO_REPORT_MONTHLY_RUN_JOB_TYPE)
    expect(JSON.parse(sched!.payload)).toEqual({ comparisonMode: 'prev_period' })
    expect(sched!.enabled).toBe(true)
    expect(sched!.nextRunAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('updates the schedule on a second PUT (upsert)', async () => {
    const res = await PUT(jsonReq('PUT', { enabled: false, day: 10, time: '09:00', comparisonMode: 'prev_year' }))
    expect(res.status).toBe(200)
    const { id } = await res.json()

    const sched = await prisma.schedule.findUnique({ where: { id } })
    expect(sched!.cadence).toBe('monthly:10@09:00')
    expect(JSON.parse(sched!.payload)).toEqual({ comparisonMode: 'prev_year' })
    expect(sched!.enabled).toBe(false)

    // Still exactly one row with this name
    const count = await prisma.schedule.count({ where: { name: SEO_REPORT_MONTHLY_SCHEDULE_NAME } })
    expect(count).toBe(1)
  })

  it('accepts day=1 and day=28 (boundary values)', async () => {
    for (const day of [1, 28]) {
      const res = await PUT(jsonReq('PUT', { enabled: true, day, time: '00:00', comparisonMode: 'prev_period' }))
      expect(res.status).toBe(200)
      const { id } = await res.json()
      const sched = await prisma.schedule.findUnique({ where: { id } })
      expect(sched!.cadence).toBe(`monthly:${day}@00:00`)
    }
  })
})

describe('GET /api/reports/schedule — after PUT', () => {
  it('returns the upserted schedule with parsed day/time/comparisonMode', async () => {
    // Ensure a known state
    await PUT(jsonReq('PUT', { enabled: true, day: 15, time: '07:30', comparisonMode: 'prev_year' }))

    const res = await GET(jsonReq('GET'))
    expect(res.status).toBe(200)
    const { schedule } = await res.json()
    expect(schedule).not.toBeNull()
    expect(schedule.enabled).toBe(true)
    expect(schedule.cadence).toBe('monthly:15@07:30')
    expect(schedule.day).toBe(15)
    expect(schedule.time).toBe('07:30')
    expect(schedule.comparisonMode).toBe('prev_year')
    expect(schedule.nextRunAt).toBeTruthy()
  })
})

describe('Non-system schedule assertion', () => {
  it('schedule name does not start with "system-"', () => {
    expect(SEO_REPORT_MONTHLY_SCHEDULE_NAME.startsWith('system-')).toBe(false)
  })

  it('is not in SYSTEM_SCHEDULES list', () => {
    const systemNames = SYSTEM_SCHEDULES.map(s => s.name)
    expect(systemNames).not.toContain(SEO_REPORT_MONTHLY_SCHEDULE_NAME)
  })

  it('seedSystemSchedules retired-row cleanup query would NOT match it', async () => {
    // The cleanup does: where: { name: { startsWith: 'system-', notIn: SYSTEM_SCHEDULES.map(s=>s.name) } }
    // Since SEO_REPORT_MONTHLY_SCHEDULE_NAME does not start with 'system-', it is
    // immune to the cleanup regardless of whether it appears in SYSTEM_SCHEDULES.
    const wouldBeRetired = await prisma.schedule.findMany({
      where: {
        name: {
          startsWith: 'system-',
          notIn: SYSTEM_SCHEDULES.map(s => s.name),
        },
      },
      select: { name: true },
    })
    const retiredNames = wouldBeRetired.map(r => r.name)
    expect(retiredNames).not.toContain(SEO_REPORT_MONTHLY_SCHEDULE_NAME)
  })
})
