import { UsersWorkspace } from '@/components/users/UsersWorkspace'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function UsersPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <UsersWorkspace />
    </QueryProvider>
  )
}
