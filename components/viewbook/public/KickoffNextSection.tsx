import type { ViewbookStage } from '@/lib/viewbook/stages'
import { KickoffNextButton } from './KickoffNextButton'

export function KickoffNextSection({
  isOperator,
  stage,
  csmName,
  viewbookId,
}: {
  isOperator: boolean
  stage: ViewbookStage
  csmName: string | null
  viewbookId: number
}) {
  if (stage !== 'kickoff') return null

  return (
    <section className="rounded-2xl border border-black/10 bg-white/90 p-6 shadow-sm">
      {isOperator ? (
        <div className="space-y-3">
          <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            Ready for the next step?
          </h2>
          <p className="text-black/70">Advance the client when the kickoff conversation is complete.</p>
          <KickoffNextButton viewbookId={viewbookId} />
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>Questions?</h2>
          <p className="text-black/70">
            {csmName ? `Reach out to ${csmName}, your primary contact.` : 'Reach out to your Enrollment Resources contact.'}
          </p>
        </div>
      )}
    </section>
  )
}
