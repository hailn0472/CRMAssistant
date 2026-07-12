import { ContactsTable } from '@/components/contacts/ContactsTable'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function ContactsPage(): React.JSX.Element {
  return (
    <>
<QueryProvider>
        <ContactsTable />
      </QueryProvider>
    </>
  )
}
