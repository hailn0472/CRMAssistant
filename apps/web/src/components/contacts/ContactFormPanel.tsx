'use client'

import Link from 'next/link'

import { ContactForm } from '@/components/contacts/ContactForm'

/// Route-level presentation of ContactForm for /contacts/new.
/// Editing an existing contact happens inline on the detail page instead.
export function ContactFormPanel(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-bold tracking-tight text-slate-900">New contact</h1>
        <p className="text-[13.5px] text-slate-500">
          Only a name and email are required — fill the rest later.
        </p>
      </div>

      <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <ContactForm />
      </div>

      <Link
        href="/contacts"
        className="inline-flex text-[13px] text-slate-500 transition-colors hover:text-slate-900"
      >
        ← Back to contacts
      </Link>
    </div>
  )
}
