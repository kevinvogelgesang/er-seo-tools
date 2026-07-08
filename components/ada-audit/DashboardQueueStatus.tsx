'use client'

import Link from 'next/link'
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'
import { computeActivePhaseSummary } from '@/lib/ada-audit/queue-ui-helpers'

interface Props {
  /** `null` while the first poll is in flight; otherwise a snapshot from
   *  `/api/site-audit/queue`. Treat `null` as "loading" (skeleton), not
   *  "idle" — false idle would hide the only prominent queue link while
   *  a queue actually exists. */
  queueStatus: QueueStatusWithBatch | null
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
      {children}
    </div>
  )
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-4">{children}</div>
}

// Header bar: a Link when there's somewhere to go, a static div on idle/skeleton.
function CardHeader(
  props:
    | { href: string; title: string; trailing?: React.ReactNode }
    | { href?: undefined; title: string; trailing?: React.ReactNode; idle: true },
) {
  const base = 'flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep'
  const titleEl = (
    <span className="font-display font-bold text-[14px] text-navy dark:text-white">
      {props.title}
    </span>
  )
  if ('href' in props && props.href) {
    return (
      <Link
        href={props.href}
        className={`${base} hover:bg-gray-100 dark:hover:bg-navy-light transition-colors`}
      >
        {titleEl}
        {props.trailing}
      </Link>
    )
  }
  return (
    <div className={`${base} opacity-40`} aria-disabled="true">
      {titleEl}
      {props.trailing}
    </div>
  )
}

function SkeletonBar({ width }: { width: string }) {
  return (
    <div
      className={`h-3 rounded bg-gray-100 dark:bg-navy-light animate-pulse ${width}`}
      aria-hidden="true"
    />
  )
}

export default function DashboardQueueStatus({ queueStatus }: Props) {
  // Pre-first-poll: skeleton state so we don't lie about idle.
  if (queueStatus === null) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CardShell>
          <CardHeader idle title="Current Scan" />
          <CardBody>
            <SkeletonBar width="w-2/3" />
            <div className="h-2" />
            <SkeletonBar width="w-1/2" />
          </CardBody>
        </CardShell>
        <CardShell>
          <CardHeader idle title="Queue" />
          <CardBody>
            <SkeletonBar width="w-2/3" />
            <div className="h-2" />
            <SkeletonBar width="w-1/3" />
          </CardBody>
        </CardShell>
      </div>
    )
  }

  const active = queueStatus.active
  const queued = queueStatus.queued
  const isIdle = active === null && queued.length === 0

  if (isIdle) {
    const idleMessage = (
      <p className="text-[13px] font-body text-navy/40 dark:text-white/40">
        No scans running or queued
      </p>
    )
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CardShell>
          <CardHeader idle title="Current Scan" />
          <CardBody>{idleMessage}</CardBody>
        </CardShell>
        <CardShell>
          <CardHeader idle title="Queue" />
          <CardBody>{idleMessage}</CardBody>
        </CardShell>
      </div>
    )
  }

  // Active or queued — at least one card is interactive.
  const queuedCount = queued.length
  const queueLabel = queuedCount > 0 ? `Queue (${queuedCount})` : 'Queue'
  const queueHref = '/ada-audit/queue'

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* ── Current Scan card ────────────────────────────────────────────── */}
      {active ? (
        <CardShell>
          <CardHeader
            // C11: seoOnly audits carry no ADA data — route to /seo-parser
            // (the ADA site page redirects it away).
            href={active.seoOnly ? '/seo-parser' : `/ada-audit/site/${active.id}`}
            title={active.seoOnly ? 'Current Scan · SEO' : 'Current Scan'}
          />
          <CardBody>
            <CurrentScanContent active={active} />
          </CardBody>
        </CardShell>
      ) : (
        <CardShell>
          <CardHeader idle title="Current Scan" />
          <CardBody>
            <p className="text-[13px] font-body text-navy/40 dark:text-white/40">
              No scans running
            </p>
          </CardBody>
        </CardShell>
      )}

      {/* ── Queue card ───────────────────────────────────────────────────── */}
      {queuedCount > 0 ? (
        <CardShell>
          <CardHeader href={queueHref} title={queueLabel} />
          <CardBody>
            <QueueListContent queued={queued} />
          </CardBody>
        </CardShell>
      ) : (
        <CardShell>
          <CardHeader idle title="Queue" />
          <CardBody>
            <p className="text-[13px] font-body text-navy/40 dark:text-white/40">
              No audits waiting
            </p>
          </CardBody>
        </CardShell>
      )}
    </div>
  )
}

function CurrentScanContent({ active }: { active: NonNullable<QueueStatusWithBatch['active']> }) {
  const { label, complete, total, pct, unit } = computeActivePhaseSummary(active)
  return (
    <div className="space-y-2">
      <p className="font-body font-semibold text-[14px] text-navy dark:text-white truncate" title={active.domain}>
        {active.domain}
      </p>
      <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
        {label}
        {total > 0
          ? ` · ${complete} / ${total} ${unit} (${pct}%)`
          : ` · discovering ${unit}…`}
      </p>
      <div className="w-full bg-gray-200/60 dark:bg-navy-light rounded-full h-1.5 overflow-hidden">
        <div
          className="bg-orange h-1.5 rounded-full transition-all duration-500"
          style={{ width: total > 0 ? `${pct}%` : '0%' }}
        />
      </div>
    </div>
  )
}

function QueueListContent({ queued }: { queued: QueueStatusWithBatch['queued'] }) {
  const visible = queued.slice(0, 3)
  const overflow = queued.length - visible.length
  return (
    <div className="space-y-1">
      <p className="font-body font-semibold text-[14px] text-navy dark:text-white">
        {queued.length} audit{queued.length !== 1 ? 's' : ''} waiting
      </p>
      <p className="text-[12px] font-body text-navy/50 dark:text-white/50 truncate">
        {visible.map((q) => q.domain).join(', ')}
        {overflow > 0 && ` …and ${overflow} more`}
      </p>
    </div>
  )
}
