import { UserFormPanel } from '@/components/users/UserFormPanel'
import { QueryProvider } from '@/components/contacts/QueryProvider'

export default function NewUserPage(): React.JSX.Element {
  return (
    <QueryProvider>
      <UserFormPanel />
    </QueryProvider>
  )
}
