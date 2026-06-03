import { ContactsTable } from '@/components/contacts/ContactsTable'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import { WorkspaceHeader } from '@/components/layout/AppShell'

export default function ContactsPage(): React.JSX.Element {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Contacts"
        title="Customer source of truth"
        description="Manage tenant-scoped customer records with pagination, validation, and secure GraphQL access."
      />
      <QueryProvider>
        <ContactsTable />
      </QueryProvider>
    </>
  )
}
