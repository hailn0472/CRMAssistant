import { UsersTable } from '@/components/users/UsersTable'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function UsersPage(): React.JSX.Element {
  return (
    <>
<QueryProvider>
        <UsersTable />
      </QueryProvider>
    </>
  )
}
