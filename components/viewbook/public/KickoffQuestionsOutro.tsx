// The anonymous "Questions?" kickoff outro. Server-SAFE (NO 'use client') so
// the anonymous kickoff branch stays fully server-rendered and never pulls the
// operator/presentation client module into its bundle (Codex PR8 re-review P2).
// Shared: the operator CTA (KickoffNextCta, client) falls back to this EXACT
// block in presentation mode; a client component may import a pure server-safe
// component.
export function KickoffQuestionsOutro({ csmName }: { csmName: string | null }) {
  return (
    <div className="space-y-2">
      <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>Questions?</h2>
      <p className="text-black/70">
        {csmName ? `Reach out to ${csmName}, your primary contact.` : 'Reach out to your Enrollment Resources contact.'}
      </p>
    </div>
  )
}
