import { prisma } from '@/lib/db'

export async function getAdaAuditChecks(adaAuditId: string) {
  return prisma.adaAuditCheck.findMany({ where: { adaAuditId }, orderBy: { createdAt: 'asc' } })
}

export async function setAdaAuditCheck(input: {
  adaAuditId: string
  scope: 'node'
  key: string
  checked: boolean
  operator: string | null
}) {
  const { adaAuditId, scope, key, checked, operator } = input
  if (checked) {
    await prisma.adaAuditCheck.upsert({
      where: { adaAuditId_scope_key: { adaAuditId, scope, key } },
      create: { adaAuditId, scope, key, checkedBy: operator },
      update: { checkedBy: operator },
    })
  } else {
    await prisma.adaAuditCheck.deleteMany({ where: { adaAuditId, scope, key } })
  }
  return getAdaAuditChecks(adaAuditId)
}

export async function getSiteAuditChecks(siteAuditId: string) {
  return prisma.siteAuditCheck.findMany({ where: { siteAuditId }, orderBy: { createdAt: 'asc' } })
}

export async function setSiteAuditCheck(input: {
  siteAuditId: string
  scope: 'page' | 'page-violation'
  key: string
  checked: boolean
  operator: string | null
}) {
  const { siteAuditId, scope, key, checked, operator } = input
  if (checked) {
    await prisma.siteAuditCheck.upsert({
      where: { siteAuditId_scope_key: { siteAuditId, scope, key } },
      create: { siteAuditId, scope, key, checkedBy: operator },
      update: { checkedBy: operator },
    })
  } else {
    await prisma.siteAuditCheck.deleteMany({ where: { siteAuditId, scope, key } })
  }
  return getSiteAuditChecks(siteAuditId)
}
