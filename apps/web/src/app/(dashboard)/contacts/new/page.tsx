import { ContactFormPanel } from '@/components/contacts/ContactFormPanel'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function NewContactPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <ContactFormPanel />
    </QueryProvider>
  )
}
