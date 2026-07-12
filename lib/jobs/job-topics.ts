// lib/jobs/job-topics.ts — maps a job's groupKey to its SSE topic, via an
// allowlist of known prefixes. Unknown prefixes (and null) map to null so a
// job type nobody has wired a topic for silently emits nothing, rather than
// guessing at a topic string.
import { adaAuditTopic, reportTopic, siteAuditTopic } from '@/lib/events/topics'

export function topicForGroup(groupKey: string | null): string | null {
  if (!groupKey) return null
  if (groupKey.startsWith('site-audit:')) {
    return siteAuditTopic(groupKey.slice('site-audit:'.length))
  }
  if (groupKey.startsWith('ada-audit:')) {
    return adaAuditTopic(groupKey.slice('ada-audit:'.length))
  }
  if (groupKey.startsWith('seo-report:')) {
    return reportTopic(groupKey.slice('seo-report:'.length))
  }
  if (groupKey.startsWith('report:')) {
    return reportTopic(groupKey.slice('report:'.length))
  }
  return null
}
