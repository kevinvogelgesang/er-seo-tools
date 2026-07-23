import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ViewbookEditor } from '@/components/viewbook/admin/ViewbookEditor'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Onboarding Viewbook Editor' }

export default async function ViewbookEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[1-9][0-9]*$/.test(id)) notFound()
  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <ViewbookEditor viewbookId={parseInt(id, 10)} />
    </div>
  )
}
