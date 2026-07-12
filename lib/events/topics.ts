// lib/events/topics.ts — literal topic strings (no Class.name/minification risk)
export const queueTopic = () => 'queue'
export const recentsTopic = () => 'recents'
export const clientSummaryTopic = () => 'client-audit-summary'
export const reportListTopic = () => 'report-list'
export const prospectListTopic = () => 'prospect-list'
export const siteAuditTopic = (id: string | number) => `site-audit:${id}`
export const adaAuditTopic = (id: string | number) => `ada-audit:${id}`
export const reportTopic = (id: string | number) => `report:${id}`
export const contentAuditTopic = (id: string | number) => `content-audit:${id}`
export const memoTopic = (sessionId: string | number) => `memo:${sessionId}`
export const pillarAnalysisTopic = (sessionId: string | number) => `pillar-analysis:${sessionId}`
export const auditBatchTopic = (id: string | number) => `audit-batch:${id}`
