import { ContactsTable } from '@/components/contacts/ContactsTable'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function ContactsPage(): React.JSX.Element {
  return (
    <main className="crm-mesh min-h-screen p-6 text-white">
      <section className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-200">
            Contacts
          </p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em]">Customer source of truth</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Manage tenant-scoped customer records with pagination, validation, and secure GraphQL
            access.
          </p>
        </div>
        <QueryProvider>
          <ContactsTable />
        </QueryProvider>
      </section>
    </main>
  )
}
