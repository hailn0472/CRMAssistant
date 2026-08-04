import { ContactsWorkspace } from '@/components/contacts/ContactsWorkspace'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function ContactsPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <ContactsWorkspace />
    </QueryProvider>
  )
}
