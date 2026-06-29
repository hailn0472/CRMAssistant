import Link from 'next/link'

import { UserForm } from '@/components/users/UserForm'
import { WorkspaceHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'

export default function NewUserPage(): React.JSX.Element {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Users"
        title="Create user"
        description="Add a new team member to your workspace. They will receive a welcome email."
        actions={
          <Button asChild variant="outline">
            <Link href="/users">Back to users</Link>
          </Button>
        }
      />
      <UserForm />
    </>
  )
}
