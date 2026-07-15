'use client'
// C14 redesign: inquiry form — the Book-a-review scroll target (#inquiry).
// PLACEHOLDER behavior (Kevin decision): submit composes a mailto: to
// SALES_CONTACT_EMAIL with the fields prefilled — works today, zero backend.
// The section shell is structured so a future embedded Jotform swaps in
// behind the same card. A plain mailto link remains for no-JS/print.
import { useState, type FormEvent } from 'react'

export function InquiryForm(props: { contactEmail: string; prospectName: string; domain: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const subject = `Website audit review — ${props.domain}`
    const body = [
      `Prospect: ${props.prospectName} (${props.domain})`,
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      '',
      message,
    ].join('\n')
    window.location.href = `mailto:${props.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 dark:border-navy-border bg-white dark:bg-white/5 px-3 py-2 text-[13px] font-body text-navy dark:text-white placeholder:text-navy/30 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <section
      id="inquiry"
      className="scroll-mt-24 bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6 space-y-4"
    >
      <div>
        <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">Book a review</h2>
        <p className="mt-1 text-[13px] font-body text-navy/60 dark:text-white/60">
          Ask us what we would fix first on {props.domain} — and what it would be worth.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="inq-name" className="block text-[12px] font-body text-navy/50 dark:text-white/50 mb-1">Name</label>
            <input id="inq-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="inq-email" className="block text-[12px] font-body text-navy/50 dark:text-white/50 mb-1">Email</label>
            <input id="inq-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="inq-phone" className="block text-[12px] font-body text-navy/50 dark:text-white/50 mb-1">Phone</label>
            <input id="inq-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label htmlFor="inq-message" className="block text-[12px] font-body text-navy/50 dark:text-white/50 mb-1">Message</label>
          <textarea id="inq-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} />
        </div>
        <button
          type="submit"
          className="rounded-full bg-blue-700 hover:bg-blue-800 text-white font-heading font-semibold text-[13px] px-5 py-2"
        >
          Send inquiry
        </button>
      </form>
      <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
        Prefer email?{' '}
        <a href={`mailto:${props.contactEmail}`} className="font-heading font-semibold text-blue-700 dark:text-blue-400">
          {props.contactEmail}
        </a>
      </p>
    </section>
  )
}
