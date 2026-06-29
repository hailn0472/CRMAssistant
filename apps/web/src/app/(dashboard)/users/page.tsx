import { UsersTable } from '@/components/users/UsersTable'
import { QueryProvider } from '@/components/contacts/QueryProvider'
import { WorkspaceHeader } from '@/components/layout/AppShell'

export default function UsersPage(): React.JSX.Element {
  return (
    <>
      <WorkspaceHeader
        eyebrow="Users"
        title="Team members"
        description="Manage team members, their roles, and access to the system."
      />
      <QueryProvider>
        <UsersTable />
      </QueryProvider>
    </>
  )
}
