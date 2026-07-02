// lib/jobs/handlers/health-alert.ts
//
// D0 failure alert. Every 15m: collect signals, evaluate, and POST to an
// optional webhook. Commit-rule: advance dedup state only when there was
// nothing to send, the send succeeded, or the webhook is deliberately dark.
// A real delivery failure leaves state unchanged so the next tick retries.
// Never throws — a monitoring job must not itself become a failed job.
import { registerJobHandler } from '../registry'
import { readAlertState, writeAlertState } from '@/lib/ops/alert-state'
import { sendAlert } from '@/lib/ops/alert-webhook'
import { collectHealthSignals, evaluateHealth, healthEvalOpts } from '@/lib/ops/health-check'

export const HEALTH_ALERT_JOB_TYPE = 'health-alert'

export async function runHealthAlert(now: Date = new Date()): Promise<void> {
  const opts = healthEvalOpts()
  const state = await readAlertState()
  const since = state.lastCheckAt || now.getTime() - opts.lookbackMs
  const signals = await collectHealthSignals(now, since)
  const { alerts, nextState } = evaluateHealth(signals, state, now, opts)

  if (alerts.length === 0) {
    await writeAlertState(nextState)
    return
  }
  const text = `:rotating_light: er-seo-tools alert (${process.env.NEXT_PUBLIC_APP_URL || 'prod'})\n${alerts.join('\n')}`
  const send = await sendAlert(text)
  if (send.sent || send.skipped) {
    await writeAlertState(nextState)
  }
  // else: genuine delivery failure — leave state unchanged, retry next tick.
}

export function registerHealthAlertHandler(): void {
  registerJobHandler({
    type: HEALTH_ALERT_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 1, // the next 15m slot is the retry
    timeoutMs: 60 * 1000,
    handler: async () => {
      try {
        await runHealthAlert()
      } catch (err) {
        console.warn(`[health-alert] unexpected failure: ${(err as Error).message}`)
      }
    },
  })
}
