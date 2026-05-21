import Link from 'next/link'

import { ContactForm } from '@/components/contacts/ContactForm'

export default function NewContactPage(): React.JSX.Element {
  return (
    <main className="crm-mesh min-h-screen p-6 text-white">
      <section className="mx-auto max-w-4xl">
        <Link className="text-sm text-cyan-100 hover:text-cyan-200" href="/contacts">
          Back to contacts
        </Link>
        <div className="my-6">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-200">
            New contact
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em]">Create contact</h1>
        </div>
        <ContactForm />
      </section>
    </main>
  )
}
