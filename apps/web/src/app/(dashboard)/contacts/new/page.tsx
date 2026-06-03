import Link from 'next/link'

import { ContactForm } from '@/components/contacts/ContactForm'
import { WorkspaceHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'

export default function NewContactPage(): React.JSX.Element {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Contacts"
        title="Create contact"
        description="Add a tenant-scoped customer record with the key details your sales team needs."
        actions={
          <Button asChild variant="outline">
            <Link href="/contacts">Back to contacts</Link>
          </Button>
        }
      />
      <ContactForm />
    </>
  )
}
